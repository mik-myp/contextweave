import { removeItems } from './services/bulk-removal'
import {
  deleteTagsSchema,
  deleteKernelsSchema,
  renameKernelSchema,
  installKernelSchema,
  managedKernelIdSchema,
  bulkDeleteResultSchema,
} from '@contextweave/contracts'
import { createBookmarkHandlers } from './bookmarks-ipc'
import { BookmarkSettingsRepository } from '@contextweave/storage'
import { createEnvironmentCommandDispatcher } from './services/environment-command-dispatcher'
import { createBatchService } from './services/batch-service'
import { dataChangedSchema, type DataChanged } from '@contextweave/contracts'
import { realpathSync } from 'node:fs'
import { WorkspacePaths } from '@contextweave/storage'
import { createArtifactService } from './services/artifacts'
import { createHistoryCleanupService } from './services/history-cleanup'
import { createIpLocaleService } from './services/ip-locale'
import { createIpLocalePreview } from './services/ip-locale-preview'
import { z } from 'zod'
import {
  assertWorkspaceContext,
  workspaceCommandSchema,
  activityHistoryQuerySchema,
  operationHistoryQuerySchema,
  environmentIdSchema,
  readThemeConfig,
  themeConfigSchema,
  commandRequestIdSchema,
  saveProxyInputSchema,
  credentialCleanupStatusSchema,
  kernelCatalogInputSchema,
  customKernelSourceSchema,
  type DataDomain,
  type IpcResult,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'
import type {
  ArtifactRepository,
  EnvironmentRepository,
  WorkspaceRepository,
} from '@contextweave/storage'
import { workerTaskIdSchema } from '@contextweave/worker-protocol'
import { getEnvironmentDetails } from './environment-management'
import {
  importProxyConfigurations,
  resolveProxyTestConfiguration,
  saveProxyConfiguration,
  deleteProxyConfiguration,
  drainCredentialCleanup,
  toProxySummary,
} from './proxy-management'
import { testProxyTransport } from './services/proxy-transport'
import { createWorkspaceCredentialStore, type SecureStorage } from './services/credentials'
import { kernelProviders, requireKernelProvider } from './services/kernel-providers'
import { createKernelService } from './services/kernel-service'
import { createEnvironmentService } from './services/environment-service'
import { checkEnvironment } from './services/preflight'
import { createRuntimeSupervisor } from './services/runtime-supervisor'
import { createWorkerService } from './services/worker-service'
import type { ForkWorker } from './services/worker-process'
import { createCommandCoordinator } from './services/command-coordinator'
import { ok, fail, toSummary } from './services/result'

export function createApplication(options: {
  repository: EnvironmentRepository
  workspaceRepository: WorkspaceRepository
  artifactRepository: ArtifactRepository
  dataRoot: string
  platform: TargetPlatform
  arch: TargetArchitecture
  secure: SecureStorage
  workerPath: string
  forkWorker: ForkWorker
  changed(event: DataChanged): void
}) {
  const { dataRoot, platform, arch } = options
  const workspace = options.workspaceRepository.current()
  const changed = (domains: DataDomain[]) =>
    options.changed(dataChangedSchema.parse({ workspaceId: workspace.workspaceId, domains }))
  assertWorkspaceContext(workspace, options.repository.context)
  assertWorkspaceContext(workspace, { workspaceId: options.artifactRepository.workspaceId })
  const paths = new WorkspacePaths({ workspaceId: workspace.workspaceId }, dataRoot)
  const repository = options.repository.withPaths(paths)
  paths.assertDatabase(options.artifactRepository.databasePath)
  if (
    realpathSync(repository.databasePath) !== realpathSync(options.artifactRepository.databasePath)
  )
    throw new Error('WORKSPACE_MISMATCH')
  const credentials = createWorkspaceCredentialStore(repository.context, paths, options.secure)
  let temporaryFilesPending = false
  const cleanupStatus = () =>
    credentialCleanupStatusSchema.parse({
      pendingCount: repository.pendingCredentialCleanup().length,
      temporaryFilesPending,
    })
  const retryCredentialCleanup = () => {
    try {
      credentials.cleanupTemporaryFiles()
      temporaryFilesPending = false
    } catch {
      temporaryFilesPending = true
    }
    drainCredentialCleanup(repository, credentials)
  }
  retryCredentialCleanup()
  const kernels = createKernelService(repository, platform, arch, paths.kernels(), () =>
    changed(['kernels']),
  )
  const environments = createEnvironmentService(
    repository,
    kernels,
    paths.environments(),
    platform,
    arch,
  )
  const preflight = async (id: string) => {
    const record = repository.get(id)
    if (!record) throw new Error('NOT_FOUND')
    return checkEnvironment(record, repository, kernels, credentials)
  }
  const locale = createIpLocaleService()
  const localePreview = createIpLocalePreview(repository, credentials, locale)
  const runtime = createRuntimeSupervisor({
    paths,
    locale,
    repository,
    kernels,
    credentials,
    preflight,
    changed: () => changed(['environments', 'activity', 'kernels']),
  })
  const artifacts = createArtifactService(
    options.artifactRepository,
    changed,
    paths.workerResults(),
  )
  const workers = createWorkerService(runtime, options.workerPath, options.forkWorker, artifacts)
  const commands = createCommandCoordinator(repository, () =>
    changed(['environments', 'operations', 'activity', 'storage']),
  )
  const historyCleanup = createHistoryCleanupService(repository, changed)
  let closing = false
  let updating = false
  const id = (input: unknown) => environmentIdSchema.parse(input)
  const environmentCommands = createEnvironmentCommandDispatcher({
    repository,
    coordinator: commands,
    environments,
    runtime,
    cancelWorkers: (environmentId) => workers.cancelEnvironment(environmentId),
    assertRoots: () => paths.assertRoots(),
    changed: () => changed(['commands', 'environments', 'operations']),
  })
  const environmentBusy = (environmentId: string) =>
    environmentCommands.busy(environmentId) || commands.busy(environmentId)
  const batches = createBatchService({
    repository,
    busy: environmentBusy,
    cancelQueuedCommand: environmentCommands.cancelIfQueued,
    execute: (action, environmentId, revision, requestId) => {
      if (closing) return Promise.resolve(fail('APP_CLOSING'))
      if (updating) return Promise.resolve(fail('APP_UPDATING'))
      paths.assertRoots()
      return environmentCommands.runBatch(action, environmentId, revision, requestId)
    },
    changed: () => changed(['batches']),
  })
  const handlers: Record<
    string,
    (input?: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>>
  > = {
    ...createBookmarkHandlers(new BookmarkSettingsRepository(repository), () =>
      changed(['bookmarks']),
    ),
    'batch:preview': (input) => ok(batches.preview(input)),
    'batch:confirm': (input) => ok(batches.confirm(input)),
    'batch:page': (input) => ok(batches.page(input)),
    'batch:get': (input) => ok(batches.get(input)),
    'batch:cancel': (input) => ok(batches.cancel(input)),
    'batch:retry-preview': (input) => ok(batches.retryPreview(input)),
    'organization:list': () => ok(repository.organization.snapshot()),
    'organization:tags-delete': async (input) => {
      const result = await removeItems(
        deleteTagsSchema.parse(input),
        (tag) => tag.id,
        (tag) => ok(repository.organization.deleteTag(tag)),
      )
      changed(['organization'])
      return ok(bulkDeleteResultSchema.parse(result))
    },
    'organization:tag-create': (input) => {
      const result = repository.organization.createTag(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:tag-update': (input) => {
      const result = repository.organization.updateTag(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:tag-delete': (input) => {
      const result = repository.organization.deleteTag(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:group-create': (input) => {
      const result = repository.organization.createGroup(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:group-update': (input) => {
      const result = repository.organization.updateGroup(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:group-delete': (input) => {
      const result = repository.organization.deleteGroup(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:metadata-save': (input) => {
      const result = repository.organization.saveEnvironment(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:view-create': (input) => {
      const result = repository.organization.createView(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:view-update': (input) => {
      const result = repository.organization.updateView(input)
      changed(['organization'])
      return ok(result)
    },
    'organization:view-delete': (input) => {
      const result = repository.organization.deleteView(input)
      changed(['organization'])
      return ok(result)
    },
    'kernel:providers': () => ok(kernelProviders),
    'kernel:prepare-custom': async (input) =>
      ok(await kernels.prepareCustom(customKernelSourceSchema.parse(input))),
    'kernel:catalog': (input) => {
      const parsed = kernelCatalogInputSchema.parse(input)
      requireKernelProvider(parsed.providerId)
      return kernels.catalog(parsed.refresh).then(ok)
    },
    'kernel:list': () => ok(kernels.list()),
    'kernel:rename': (input) => ok(kernels.rename(renameKernelSchema.parse(input))),
    'kernel:verify': (input) => kernels.verify(managedKernelIdSchema.parse(input)).then(ok),
    'kernel:remove-many': (input) => {
      const ids = deleteKernelsSchema.parse(input)
      return commands.run('remove-kernel', null, async () =>
        ok(
          bulkDeleteResultSchema.parse(
            await removeItems(
              ids,
              (id) => id,
              async (id) => ok(await kernels.remove(id)),
            ),
          ),
        ),
      )
    },
    'kernel:install': (input) => {
      const { id: kernelId, name } = installKernelSchema.parse(input)
      return commands.run('install', null, async () => ok(await kernels.install(kernelId, name)))
    },
    'kernel:remove': (input) =>
      commands.run('remove-kernel', null, async () => ok(await kernels.remove(id(input)))),
    'kernel:cancel-install': (input) => ok(kernels.cancelInstall(id(input))),
    'environment:detect-locale': async (input) => ok(await localePreview.detect(input)),
    'environment:cancel-locale': (input) => ok(localePreview.cancel(input)),
    'environment:list': () => ok(repository.list().map(toSummary)),
    'environment:trash-list': () => ok(repository.listTrash().map(toSummary)),
    'environment:get': (input) => ok(getEnvironmentDetails(repository, id(input))),
    'environment:recovery-inspect': (input) => ok(runtime.inspectRecovery(id(input))),
    'environment:preflight': async (input) => ok(await preflight(id(input))),
    'environment:command-page': (input) => ok(environmentCommands.page(input)),
    'environment:command-active': () => ok(environmentCommands.active()),
    'environment:command': (input) => ok(environmentCommands.submit(input)),
    'environment:command-get': (input) =>
      ok(environmentCommands.get(commandRequestIdSchema.parse(input))),
    'environment:command-cancel': (input) =>
      ok(environmentCommands.cancel(commandRequestIdSchema.parse(input))),
    'environment:create': (input) => environmentCommands.runLegacy('create', input),
    'environment:update': (input) => environmentCommands.runLegacy('update', input),
    'environment:delete': (input) => environmentCommands.runLegacy('trash', input),
    'environment:restore': (input) => environmentCommands.runLegacy('restore', input),
    'environment:start': (input) => environmentCommands.runLegacy('start', input),
    'environment:stop': (input) => environmentCommands.runLegacy('stop', input),
    'environment:recover': (input) => environmentCommands.runLegacy('recover', input),
    'activity:list': () => ok(repository.pageActivity({ limit: 100 }).items),
    'operation:list': () => ok(repository.pageOperations({ limit: 100 }).items),
    'activity:page': (input) =>
      ok(repository.pageActivity(activityHistoryQuerySchema.parse(input))),
    'operation:page': (input) =>
      ok(repository.pageOperations(operationHistoryQuerySchema.parse(input))),
    'workspace:current': () => ok(options.workspaceRepository.current()),
    'storage:artifact-budget': () => ok(artifacts.budget()),
    'storage:artifact-budget-update': (input) => ok(artifacts.updateBudget(input)),
    'storage:artifacts-page': (input) => ok(artifacts.page(input)),
    'storage:orphans': () => ok(environments.orphans()),
    'storage:history-preview': (input) => ok(historyCleanup.preview(input)),
    'storage:history-confirm': (input) => ok(historyCleanup.confirm(input)),
    'storage:history-receipt': () => ok(historyCleanup.receipt()),
    'proxy:test': async (input) => {
      const { config, password } = resolveProxyTestConfiguration(repository, input, credentials)
      return ok(await testProxyTransport(config, password))
    },
    'proxy:list': () => ok(repository.listProxies().map(toProxySummary)),
    'proxy:import': (input) => {
      try {
        return ok(importProxyConfigurations(repository, input, credentials))
      } finally {
        retryCredentialCleanup()
        changed(['proxies'])
      }
    },
    'proxy:save': (input) => {
      const parsed = saveProxyInputSchema.parse(input)
      const refs = repository.listAll().filter((record) => record.proxyId === parsed.proxyId)
      if (refs.some((record) => environmentBusy(record.environmentId)))
        return fail('OPERATION_IN_PROGRESS')
      try {
        return ok(saveProxyConfiguration(repository, parsed, credentials))
      } finally {
        retryCredentialCleanup()
        changed(['proxies', 'environments'])
      }
    },
    'proxy:delete': (input) => {
      try {
        deleteProxyConfiguration(repository, id(input), credentials)
        return ok(true)
      } finally {
        retryCredentialCleanup()
        changed(['proxies'])
      }
    },
    'proxy:cleanup-status': (input) => {
      z.undefined().parse(input)
      return ok(cleanupStatus())
    },
    'proxy:retry-cleanup': (input) => {
      z.undefined().parse(input)
      retryCredentialCleanup()
      changed(['proxies'])
      return ok(cleanupStatus())
    },
    'settings:get-theme': () => ok(readThemeConfig(repository.getSetting<unknown>('theme'))),
    'settings:set-theme': (input) => {
      const config = themeConfigSchema.parse(input)
      repository.setSetting('theme', config)
      return ok(config)
    },
    'worker:run-smoke': (input) => workers.run(input),
    'worker:cancel': (input) => workers.cancel(workerTaskIdSchema.parse(input)),
  }
  const noInput = new Set([
    'workspace:current',
    'organization:list',
    'kernel:providers',
    'kernel:list',
    'environment:list',
    'environment:trash-list',
    'environment:command-active',
    'activity:list',
    'operation:list',
    'storage:orphans',
    'storage:artifact-budget',
    'storage:history-receipt',
    'proxy:list',
    'settings:get-theme',
    'proxy:cleanup-status',
    'proxy:retry-cleanup',
  ])
  return {
    channels: Object.keys(handlers),
    // Host-side capability; intentionally absent from handlers and the Preload whitelist.
    acquireControlLease: (environmentId: string) => runtime.leaseControl(environmentId),
    setUpdating(value: boolean) {
      updating = value
    },
    hasActiveEnvironments: () =>
      kernels.hasActive() ||
      batches.hasActive() ||
      environmentCommands.hasActive() ||
      repository
        .listAll()
        .some(
          (record) =>
            environmentBusy(record.environmentId) ||
            ['running', 'starting', 'stopping', 'needs-recovery'].includes(record.status),
        ),
    async invoke(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
      if (closing) return fail('APP_CLOSING')
      if (updating) return fail('APP_UPDATING')
      if (!Object.hasOwn(handlers, channel)) return fail('UNKNOWN_COMMAND')
      try {
        if (!['workspace:current', 'settings:get-theme', 'settings:set-theme'].includes(channel)) {
          const envelope = workspaceCommandSchema.safeParse(input)
          if (!envelope.success) return fail('WORKSPACE_CONTEXT_INVALID')
          assertWorkspaceContext(workspace, { workspaceId: envelope.data.workspaceId })
          paths.assertRoots()
          input = envelope.data.payload
        }
        if (noInput.has(channel)) z.undefined().parse(input)
        return await handlers[channel]!(input)
      } catch (error) {
        if (error instanceof z.ZodError) return fail('INVALID_INPUT')
        return fail(
          error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message)
            ? error.message
            : 'COMMAND_FAILED',
        )
      }
    },
    recover: () => {
      environmentCommands.recover()
      batches.recover()
      runtime.recoverOnStartup()
    },
    async shutdown() {
      closing = true
      const commandDrain = environmentCommands.shutdown()
      const batchDrain = batches.shutdown()
      const workerDrain = workers.shutdown()
      kernels.cancelAll()
      runtime.cancelStarts()
      const drains = await Promise.allSettled([
        kernels.drain(),
        commandDrain,
        batchDrain,
        workerDrain,
        localePreview.shutdown(),
        locale.shutdown(),
      ])
      await commands.drain()
      await runtime.shutdown()
      const failed = drains.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    },
  }
}
