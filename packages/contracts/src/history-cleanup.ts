import { z } from 'zod'

export const historyCleanupBatchLimit = 500
export const historyCleanupRetentionDaysSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.literal(365),
])
export type HistoryCleanupRetentionDays = z.infer<typeof historyCleanupRetentionDaysSchema>
export const historyCleanupRequestSchema = z.strictObject({
  retentionDays: historyCleanupRetentionDaysSchema,
})
export const historyCleanupConfirmSchema = z.strictObject({ previewId: z.string().uuid() })
const timestamp = z
  .string()
  .datetime()
  .refine((value) => {
    const time = Date.parse(value)
    return Number.isFinite(time) && new Date(time).toISOString() === value
  }, 'Expected a canonical UTC timestamp')
const count = z.number().int().min(0).max(historyCleanupBatchLimit)
const batch = z
  .strictObject({ count, hasMore: z.boolean() })
  .refine((value) => !value.hasMore || value.count === historyCleanupBatchLimit)
const scope = {
  previewId: z.string().uuid(),
  retentionDays: historyCleanupRetentionDaysSchema,
  cutoffAt: timestamp,
}
export const historyCleanupPreviewSchema = z
  .strictObject({
    ...scope,
    createdAt: timestamp,
    expiresAt: timestamp,
    sessions: batch,
    operations: batch,
  })
  .refine(
    (value) =>
      Date.parse(value.expiresAt) > Date.parse(value.createdAt) &&
      Date.parse(value.createdAt) - Date.parse(value.cutoffAt) === value.retentionDays * 86_400_000,
  )
export type HistoryCleanupPreview = z.infer<typeof historyCleanupPreviewSchema>
const outcome = z
  .strictObject({ selected: count, deleted: count, skipped: count })
  .refine((value) => value.selected === value.deleted + value.skipped)
export const historyCleanupReceiptSchema = z.strictObject({
  ...scope,
  completedAt: timestamp,
  sessions: outcome,
  operations: outcome,
})
export type HistoryCleanupReceipt = z.infer<typeof historyCleanupReceiptSchema>
export const historyCleanupResultSchema = z.strictObject({
  receipt: historyCleanupReceiptSchema,
  replayed: z.boolean(),
})
export type HistoryCleanupResult = z.infer<typeof historyCleanupResultSchema>
