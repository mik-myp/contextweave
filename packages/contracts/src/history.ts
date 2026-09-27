import { z } from 'zod'

export const historyPageLimit = 100
export const historyCursorSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/)
const historyQueryShape = {
  limit: z.number().int().min(1).max(historyPageLimit).default(20),
  search: z.string().trim().max(200).default(''),
  direction: z.enum(['asc', 'desc']).default('desc'),
  cursor: historyCursorSchema.nullable().default(null),
}
export const activityHistoryQuerySchema = z.strictObject({
  ...historyQueryShape,
  sortBy: z
    .enum([
      'environment',
      'status',
      'startedAt',
      'endedAt',
      'revision',
      'executableVersion',
      'sessionId',
      'exitReason',
    ])
    .default('startedAt'),
  statuses: z
    .array(z.enum(['starting', 'running', 'stopping', 'stopped', 'crashed']))
    .max(5)
    .default([])
    .transform((values) => [...new Set(values)].sort()),
})
export const operationHistoryQuerySchema = z.strictObject({
  ...historyQueryShape,
  sortBy: z
    .enum(['kind', 'environmentId', 'status', 'phase', 'startedAt', 'endedAt', 'errorCode'])
    .default('startedAt'),
  statuses: z
    .array(z.enum(['running', 'succeeded', 'failed', 'cancelled']))
    .max(4)
    .default([])
    .transform((values) => [...new Set(values)].sort()),
})
export type ActivityHistoryQuery = z.infer<typeof activityHistoryQuerySchema>
export type OperationHistoryQuery = z.infer<typeof operationHistoryQuerySchema>
export type HistoryQuery = ActivityHistoryQuery | OperationHistoryQuery
export type HistoryPage<T> = {
  items: T[]
  previousCursor: string | null
  nextCursor: string | null
}
export function historyPageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item).max(historyPageLimit),
    previousCursor: historyCursorSchema.nullable(),
    nextCursor: historyCursorSchema.nullable(),
  })
}
