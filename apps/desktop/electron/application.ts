import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  activitySummarySchema,
  environmentIdSchema,
  readThemeConfig,
  themeConfigSchema,
  environmentConfigSchema,
  updateEnvironmentInputSchema,
  saveProxyInputSchema,
  kernelCatalogInputSchema,
  customKernelSourceSchema,
  type DataDomain,
  type IpcResult,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'
import {
  getEnvironmentDetails,
  removeEnvironment,
  updateEnvironment,
  assertProxyMutable,
  resolveEnvironmentProxy,
} from './environment-management'
import {
  resolveProxyTestConfiguration,
  saveProxyConfiguration,
  toProxySummary,
} from './proxy-management'
import { testProxyTransport } from './services/proxy-transport'
import { createCredentialStore, type SecureStorage } from './services/credentials'
import { kernelProviders, requireKernelProvider } from './services/kernel-providers'
import { createKernelService } from './services/kernel-service'
import { createEnvironmentService } from './services/environment-service'
import { checkEnvironment } from './services/preflight'
import { createRuntimeSupervisor } from './services/runtime-supervisor'
import { createWorkerService } from './services/worker-service'
import { createCommandCoordinator } from './services/command-coordinator'
import { ok, fail, toSummary } from './services/result'

export function createApplication(options: {
  repository: EnvironmentRepository
  dataRoot: string
  platform: TargetPlatform
  arch: TargetArchitecture
  secure: SecureStorage
  workerPath: string
  changed(domains: DataDomain[]): void
}) {
  const { repository, dataRoot, platform, arch, changed } = options
  const credentials = createCredentialStore(join(dataRoot, 'credentials.json'), options.secure)
  const kernels = createKernelService(repository, platform, arch, join(dataRoot, 'kernels'), () =>
    changed(['kernels']),
  )
  const environments = createEnvironmentService(
    repository,
    kernels,
    join(dataRoot, 'environments'),
    platform,
    arch,
  )
  const preflight = async (id: string) => {
    const record = repository.get(id)
    if (!record) throw new Error('NOT_FOUND')
    return checkEnvironment(record, repository, kernels, credentials)
  }
  const runtime = createRuntimeSupervisor({
    repository,
    kernels,
    credentials,
    preflight,
    changed: () => changed(['environments', 'activity', 'kernels']),
  })
  const workers = createWorkerService(runtime, options.workerPath, join(dataRoot, 'worker-results'))
  const commands = createCommandCoordinator(repository, () =>
    changed(['environments', 'operations', 'activity', 'storage']),
  )
  let closing = false
  const id = (input: unknown) => environmentIdSchema.parse(input)
  const handlers: Record<
    string,
    (input?: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>>
  > = {
    'kernel:providers': () => ok(kernelProviders),
    'kernel:prepare-custom': async (input) =>
      ok(await kernels.prepareCustom(customKernelSourceSchema.parse(input))),
    'kernel:catalog': (input) => {
      const parsed = kernelCatalogInputSchema.parse(input)
      requireKernelProvider(parsed.providerId)
      return kernels.catalog(parsed.refresh).then(ok)
    },
    'kernel:list': () => ok(kernels.list()),
    'kernel:install': (input) =>
      commands.run('install', null, async () => ok(await kernels.install(id(input)))),
    'kernel:cancel-install': (input) => ok(kernels.cancelInstall(id(input))),
    'environment:list': () => ok(repository.list().map(toSummary)),
    'environment:trash-list': () => ok(repository.listTrash().map(toSummary)),
    'environment:get': (input) => ok(getEnvironmentDetails(repository, id(input))),
    'environment:preflight': async (input) => ok(await preflight(id(input))),
    'environment:create': (input) => {
      const environmentId = `env-${randomUUID()}`
      return commands.run('create', environmentId, () =>
        ok(toSummary(environments.create(input, environmentId))),
      )
    },
    'environment:update': (input) => {
      const parsed = updateEnvironmentInputSchema.parse(input)
      if (parsed.expectedRevision === undefined) return fail('CONFIG_CONFLICT')
      return commands.run('update', parsed.environmentId, () =>
        ok(toSummary(updateEnvironment(repository, parsed))),
      )
    },
    'environment:delete': (input) =>
      commands.run('trash', id(input), () => {
        removeEnvironment(repository, input)
        return ok(true)
      }),
    'environment:restore': (input) =>
      commands.run('restore', id(input), () => ok(toSummary(environments.restore(id(input))))),
    'environment:start': (input) =>
      commands.run('start', id(input), (phase) => runtime.start(id(input), phase)),
    'environment:stop': async (input) => {
      const environmentId = id(input)
      runtime.cancelStart(environmentId)
      await commands.settled(environmentId)
      workers.cancelEnvironment(environmentId)
      return commands.run('stop', environmentId, () => runtime.stop(environmentId))
    },
    'environment:recover': (input) =>
      commands.run('recover', id(input), () => runtime.recover(id(input))),
    'activity:list': () => {
      const names = new Map(
        repository.listAll().map((record) => [record.environmentId, record.name]),
      )
      return ok(
        repository.listRuntimeSessions().map((session) =>
          activitySummarySchema.parse({
            ...session,
            environmentName: names.get(session.environmentId),
          }),
        ),
      )
    },
    'operation:list': () => {
      const names = new Map(
        repository.listAll().map((record) => [record.environmentId, record.name]),
      )
      return ok(
        repository.listOperations().map((operation) => ({
          ...operation,
          environmentName: operation.environmentId ? names.get(operation.environmentId) : undefined,
        })),
      )
    },
    'storage:orphans': () => ok(environments.orphans()),
    'proxy:test': async (input) => {
      const { config, password } = resolveProxyTestConfiguration(repository, input, credentials)
      return ok(await testProxyTransport(config, password))
    },
    'proxy:list': () => ok(repository.listProxies().map(toProxySummary)),
    'proxy:save': (input) => {
      const parsed = saveProxyInputSchema.parse(input)
      const refs = repository.listAll().filter((record) => record.proxyId === parsed.proxyId)
      if (refs.some((record) => commands.busy(record.environmentId)))
        return fail('OPERATION_IN_PROGRESS')
      const result = saveProxyConfiguration(repository, parsed, credentials)
      for (const record of refs)
        repository.updateConfig(
          resolveEnvironmentProxy(
            repository,
            environmentConfigSchema.parse(JSON.parse(record.configJson)),
          ),
        )
      changed(['proxies', 'environments'])
      return ok(result)
    },
    'proxy:delete': (input) => {
      const proxyId = id(input),
        proxy = repository.getProxy(proxyId)
      if (!proxy) return fail('NOT_FOUND')
      assertProxyMutable(repository, proxyId, true)
      credentials.remove(proxy.credentialRef)
      repository.deleteProxy(proxyId)
      changed(['proxies'])
      return ok(true)
    },
    'settings:get-theme': () => ok(readThemeConfig(repository.getSetting<unknown>('theme'))),
    'settings:set-theme': (input) => {
      const config = themeConfigSchema.parse(input)
      repository.setSetting('theme', config)
      return ok(config)
    },
    'worker:run-smoke': (input) => workers.run(input),
    'worker:cancel': (input) => workers.cancel(id(input)),
  }
  return {
    channels: Object.keys(handlers),
    async invoke(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
      if (closing) return fail('APP_CLOSING')
      try {
        return (await handlers[channel]?.(input)) ?? fail('UNKNOWN_COMMAND')
      } catch (error) {
        if (error instanceof z.ZodError) return fail('INVALID_INPUT')
        return fail(
          error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message)
            ? error.message
            : 'COMMAND_FAILED',
        )
      }
    },
    recover: () => runtime.recoverOnStartup(),
    async shutdown() {
      closing = true
      workers.shutdown()
      kernels.cancelAll()
      runtime.cancelStarts()
      await commands.drain()
      await runtime.shutdown()
    },
  }
}
