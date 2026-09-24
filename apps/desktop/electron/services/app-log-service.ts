import { z } from 'zod'
import { appLogEntrySchema, appLogSnapshotSchema, type AppLogEntry } from '@contextweave/contracts'
import { fail } from './result'

const loggedMethods = new Set([
  'environment:create',
  'environment:update',
  'environment:delete',
  'environment:restore',
  'environment:start',
  'environment:stop',
  'environment:recover',
  'proxy:save',
  'proxy:delete',
  'proxy:test',
  'kernel:install',
  'kernel:cancel-install',
  'update:check',
  'update:download',
  'update:cancel',
  'update:open-installer',
])
const envelopeSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  data: z.unknown().optional(),
})
const outcomeSchema = z.object({
  success: z.boolean().optional(),
  phase: z.string().optional(),
  errorCode: z.string().optional(),
})
const errorCode = (value: unknown) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : 'COMMAND_FAILED'
const resourceIdSchema = appLogEntrySchema.shape.fields.shape.resourceId

export function createAppLogService(limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_LOG_LIMIT')
  let entries: AppLogEntry[] = []
  let sequence = 0,
    dropped = 0
  const sessionStartedAt = new Date().toISOString()
  const snapshot = () => appLogSnapshotSchema.parse({ entries, dropped, limit, sessionStartedAt })
  const record = (input: Omit<AppLogEntry, 'id' | 'timestamp'>) => {
    const parsed = appLogEntrySchema.safeParse({
      ...input,
      id: sequence + 1,
      timestamp: new Date().toISOString(),
    })
    // Logging must not break commands. Invalid/unapproved fields are never retained.
    if (!parsed.success) return
    sequence++
    entries.push(parsed.data)
    if (entries.length > limit) {
      entries.shift()
      dropped++
    }
  }
  return {
    record,
    snapshot,
    clear() {
      entries = []
      dropped = 0
      return snapshot()
    },
    async invoke(channel: string, input: unknown, execute: () => unknown | Promise<unknown>) {
      if (!loggedMethods.has(channel)) return execute()
      const source = appLogEntrySchema.shape.source.parse(channel.split(':')[0])
      // Never serialize inputs or results. Extract only a validated resource identifier.
      const idInput =
        typeof input === 'string'
          ? input
          : z
              .object({ environmentId: z.string().optional(), proxyId: z.string().optional() })
              .safeParse(input)
      const candidate =
        typeof idInput === 'string'
          ? idInput
          : idInput.success
            ? (idInput.data.environmentId ?? idInput.data.proxyId)
            : undefined
      const id = resourceIdSchema.safeParse(candidate)
      const fields = id.success && id.data ? { resourceId: id.data } : {}
      record({ level: 'debug', source, event: 'command-started', method: channel, fields })
      const started = performance.now()
      try {
        const result = await execute()
        const envelope = envelopeSchema.safeParse(result)
        const outcome = envelope.success ? outcomeSchema.safeParse(envelope.data.data) : undefined
        const detail = outcome?.success ? outcome.data : undefined
        const code =
          envelope.success && !envelope.data.ok
            ? errorCode(envelope.data.code)
            : detail?.errorCode
              ? errorCode(detail.errorCode)
              : undefined
        const cancelled = code === 'CANCELLED' || detail?.phase === 'cancelled'
        const failed =
          !envelope.success ||
          !envelope.data.ok ||
          detail?.success === false ||
          detail?.phase === 'error' ||
          !!code
        record({
          source,
          method: channel,
          fields,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          level: cancelled ? 'warn' : failed ? 'error' : 'info',
          event: cancelled ? 'command-cancelled' : failed ? 'command-failed' : 'command-succeeded',
          errorCode: failed ? (code ?? 'COMMAND_FAILED') : undefined,
        })
        return result
      } catch {
        record({
          level: 'error',
          source,
          event: 'command-failed',
          method: channel,
          fields,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          errorCode: 'COMMAND_FAILED',
        })
        return fail('COMMAND_FAILED')
      }
    },
  }
}
