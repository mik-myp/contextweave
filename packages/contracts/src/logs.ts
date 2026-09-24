import { z } from 'zod'

export const appLogLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
export const appLogSourceSchema = z.enum(['app', 'environment', 'proxy', 'kernel', 'update'])
export const appLogEventSchema = z.enum([
  'app-started',
  'app-stopping',
  'command-started',
  'command-succeeded',
  'command-failed',
  'command-cancelled',
  'environment-state',
])
export const appLogEntrySchema = z
  .object({
    id: z.number().int().positive(),
    timestamp: z.string().datetime(),
    level: appLogLevelSchema,
    source: appLogSourceSchema,
    event: appLogEventSchema,
    method: z
      .string()
      .regex(/^[a-z]+:[a-z-]+$/)
      .max(80)
      .optional(),
    durationMs: z.number().int().nonnegative().optional(),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]+$/)
      .max(80)
      .optional(),
    fields: z
      .object({
        resourceId: z
          .string()
          .regex(
            /^(env-|proxy-|operation-|fingerprint-chromium|standard-chromium)[a-zA-Z0-9._-]{0,120}$/,
          )
          .optional(),
        status: z
          .enum([
            'created',
            'ready',
            'starting',
            'running',
            'stopping',
            'stopped',
            'error',
            'needs-recovery',
          ])
          .optional(),
      })
      .strict(),
  })
  .strict()
export const appLogSnapshotSchema = z
  .object({
    entries: z.array(appLogEntrySchema).max(1000),
    limit: z.number().int().min(1).max(1000),
    dropped: z.number().int().nonnegative(),
    sessionStartedAt: z.string().datetime(),
  })
  .strict()
export type AppLogEntry = z.infer<typeof appLogEntrySchema>
export type AppLogSnapshot = z.infer<typeof appLogSnapshotSchema>
