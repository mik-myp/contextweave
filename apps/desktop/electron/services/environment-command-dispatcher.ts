import { randomUUID } from 'node:crypto'
import {
  assertWorkspaceContext,
  commandErrorCodeSchema,
  createEnvironmentInputSchema,
  updateEnvironmentInputSchema,
  commandEnvironmentIdSchema,
  type EnvironmentCommandKind,
  type EnvironmentCommandReceipt,
  type IpcResult,
} from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'
import { removeEnvironment, updateEnvironment } from '../environment-management'
import type { createCommandCoordinator } from './command-coordinator'
import type { createEnvironmentService } from './environment-service'
import type { createRuntimeSupervisor } from './runtime-supervisor'
import { createEnvironmentCommands, type CommandOutcome } from './environment-commands'
import { fail, ok, toSummary } from './result'

const definiteFailures = new Set([
  'NOT_FOUND',
  'CONFIG_CONFLICT',
  'CONFIG_INVALID',
  'ENVIRONMENT_BUSY',
  'OPERATION_IN_PROGRESS',
  'ENVIRONMENT_TRASHED',
  'ENVIRONMENT_NOT_TRASHED',
  'ENVIRONMENT_NOT_RUNNING',
  'ALREADY_RUNNING',
  'KERNEL_UNAVAILABLE',
  'PROVIDER_UNVERIFIED',
  'PLATFORM_MISMATCH',
  'RUNTIME_BUSY',
  'RECOVERY_REQUIRED',
  'PROXY_MISSING',
  'PROXY_UNREACHABLE',
  'PROXY_TEST_FAILED',
  'CREDENTIAL_UNAVAILABLE',
  'DIRECTORY_UNWRITABLE',
  'LOW_DISK',
  'LEGACY_SETTINGS_UNSUPPORTED',
  'RECOVERY_LOCK_UNREADABLE',
  'RECOVERY_MANUAL_REQUIRED',
  'APP_CLOSING',
  'APP_UPDATING',
])
export function environmentCommandOutcome(result: IpcResult<unknown>): CommandOutcome {
  if (result.ok) return { status: 'succeeded', errorCode: null }
  if (result.code === 'CANCELLED') return { status: 'cancelled', errorCode: 'CANCELLED' }
  const code = commandErrorCodeSchema.safeParse(result.code).data
  if (code && definiteFailures.has(code)) return { status: 'failed', errorCode: code }
  // Runtime timeout / generic exceptions do not establish that external effects ended.
  return {
    status: 'unknown',
    errorCode:
      code &&
      ['STOP_TIMEOUT', 'START_FAILED', 'SPAWN_FAILED', 'COMMAND_STORAGE_FAILED'].includes(code)
        ? code
        : 'COMMAND_RESULT_UNKNOWN',
  }
}

export function createEnvironmentCommandDispatcher(options: {
  repository: EnvironmentRepository
  coordinator: ReturnType<typeof createCommandCoordinator>
  environments: ReturnType<typeof createEnvironmentService>
  runtime: ReturnType<typeof createRuntimeSupervisor>
  cancelWorkers(environmentId: string): void
  assertRoots(): void
  changed(): void
}) {
  const { repository, coordinator, runtime, environments } = options
  const service = createEnvironmentCommands({
    store: repository.commands,
    changed: options.changed,
    cancelStart: runtime.cancelStart,
    execute: async (request, receipt) => {
      const result = await coordinator.run<unknown>(
        request.kind,
        receipt.environmentId,
        (phase) => {
          options.assertRoots()
          if (request.kind !== 'create') {
            const record = repository.get(receipt.environmentId)
            if (!record) return fail('NOT_FOUND')
            assertWorkspaceContext(repository.context, { workspaceId: record.workspaceId })
            if (record.revision !== receipt.expectedRevision) return fail('CONFIG_CONFLICT')
          }
          switch (request.kind) {
            case 'create':
              return ok(toSummary(environments.create(request.input, receipt.environmentId)))
            case 'update':
              return ok(toSummary(updateEnvironment(repository, request.input)))
            case 'start':
              return runtime.start(receipt.environmentId, phase)
            case 'stop':
              options.cancelWorkers(receipt.environmentId)
              return runtime.stop(receipt.environmentId)
            case 'trash':
              removeEnvironment(repository, receipt.environmentId)
              return ok(true)
            case 'restore':
              return ok(toSummary(environments.restore(receipt.environmentId)))
            case 'recover':
              return runtime.recover(receipt.environmentId)
          }
        },
      )
      return environmentCommandOutcome(result)
    },
  })
  async function complete(receipt: EnvironmentCommandReceipt) {
    const settled = await service.wait(receipt.requestId)
    if (settled.status === 'unknown')
      return fail(
        settled.errorCode === 'COMMAND_STORAGE_FAILED'
          ? 'COMMAND_STORAGE_FAILED'
          : 'COMMAND_RESULT_UNKNOWN',
      )
    if (settled.status !== 'succeeded') return fail(settled.errorCode ?? 'COMMAND_RESULT_UNKNOWN')
    if (settled.kind === 'trash') return ok(true)
    const record = repository.get(settled.environmentId)
    return record ? ok(toSummary(record)) : fail('COMMAND_RESULT_UNKNOWN')
  }
  return {
    ...service,
    async runLegacy(kind: EnvironmentCommandKind, input: unknown) {
      let request: unknown
      if (kind === 'create') {
        const parsed = createEnvironmentInputSchema.parse(input)
        if (parsed.proxy && !parsed.proxyId) return fail('CONFIG_INVALID')
        // Compatibility callers may contain an inline saved-proxy copy; only its ID is authoritative.
        const config = { ...parsed }
        delete config.proxy
        request = { requestId: randomUUID(), kind, input: config }
      } else if (kind === 'update') {
        const parsed = updateEnvironmentInputSchema.parse(input)
        if (parsed.expectedRevision === undefined) return fail('CONFIG_CONFLICT')
        request = { requestId: randomUUID(), kind, input: parsed }
      } else {
        const environmentId = commandEnvironmentIdSchema.parse(input)
        request = {
          requestId: randomUUID(),
          kind,
          environmentId,
          expectedRevision: repository.get(environmentId)?.revision ?? 1,
        }
      }
      return complete(service.submit(request))
    },
    async runBatch(
      kind: 'start' | 'stop' | 'trash' | 'restore',
      environmentId: string,
      expectedRevision: number,
      requestId: string,
    ) {
      return complete(service.submit({ requestId, kind, environmentId, expectedRevision }))
    },
  }
}
