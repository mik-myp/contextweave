import { z } from 'zod'
import { workspaceContextSchema } from './workspaces'

export const batchActionSchema = z.enum(['start', 'stop', 'trash', 'restore'])
export type BatchAction = z.infer<typeof batchActionSchema>
export const batchIdSchema = z.string().uuid()
const environmentId = z.string().trim().min(1).max(512)
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const batchReasonSchema = z.enum([
  'NOT_FOUND',
  'CONFIG_CONFLICT',
  'ENVIRONMENT_BUSY',
  'OPERATION_IN_PROGRESS',
  'ENVIRONMENT_TRASHED',
  'ENVIRONMENT_NOT_TRASHED',
  'ENVIRONMENT_NOT_RUNNING',
  'BATCH_INTERRUPTED',
  'CANCELLED',
  'COMMAND_FAILED',
  'KERNEL_UNAVAILABLE',
  'PROVIDER_UNVERIFIED',
  'CONFIG_INVALID',
  'PROXY_MISSING',
  'APP_CLOSING',
  'APP_UPDATING',
  'BATCH_STORAGE_FAILED',
])
export type BatchReason = z.infer<typeof batchReasonSchema>
export const batchPreviewInputSchema = z.strictObject({
  action: batchActionSchema,
  environmentIds: z
    .array(environmentId)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate targets'),
})
export const batchTargetSchema = z
  .strictObject({
    environmentId,
    name: z.string().max(200),
    revision: revision.nullable(),
    reason: batchReasonSchema.nullable(),
  })
  .refine((item) => item.revision !== null || item.reason === 'NOT_FOUND')
export type BatchTarget = z.infer<typeof batchTargetSchema>
export const batchPreviewSchema = workspaceContextSchema
  .extend({
    id: batchIdSchema,
    action: batchActionSchema,
    sourceTaskId: batchIdSchema.nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    targets: z.array(batchTargetSchema).min(1).max(100),
  })
  .refine(
    (value) =>
      new Set(value.targets.map((item) => item.environmentId)).size === value.targets.length,
  )
export type BatchPreview = z.infer<typeof batchPreviewSchema>
export const batchItemStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
  'unknown',
])
export type BatchItemStatus = z.infer<typeof batchItemStatusSchema>
export const batchItemSchema = z
  .strictObject({
    environmentId,
    name: z.string().max(200),
    revision: revision.nullable(),
    ordinal: z.number().int().min(0).max(99),
    status: batchItemStatusSchema,
    reason: batchReasonSchema.nullable(),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
  })
  .refine((item) => {
    if (item.status === 'queued')
      return (
        item.startedAt === null &&
        item.endedAt === null &&
        item.reason === null &&
        item.revision !== null
      )
    if (item.status === 'running')
      return (
        item.startedAt !== null &&
        item.endedAt === null &&
        item.reason === null &&
        item.revision !== null
      )
    if (item.endedAt === null) return false
    if (item.status === 'succeeded') return item.startedAt !== null && item.reason === null
    if (item.status === 'cancelled') return item.reason === 'CANCELLED'
    if (item.status === 'failed') return item.startedAt !== null && item.reason !== null
    if (item.status === 'unknown')
      return item.startedAt !== null && item.reason === 'BATCH_INTERRUPTED'
    return item.reason !== null
  })
export type BatchItem = z.infer<typeof batchItemSchema>
export const batchStatusSchema = z.enum([
  'queued',
  'running',
  'cancelling',
  'completed',
  'cancelled',
  'interrupted',
])
export type BatchStatus = z.infer<typeof batchStatusSchema>
export const isBatchActive = (status: BatchStatus) =>
  status === 'queued' || status === 'running' || status === 'cancelling'
const count = z.number().int().min(0).max(100)
export const batchSummarySchema = workspaceContextSchema
  .extend({
    id: batchIdSchema,
    action: batchActionSchema,
    status: batchStatusSchema,
    sourceTaskId: batchIdSchema.nullable(),
    createdAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    total: z.number().int().min(1).max(100),
    counts: z.strictObject({
      queued: count,
      running: count,
      succeeded: count,
      failed: count,
      skipped: count,
      cancelled: count,
      unknown: count,
    }),
  })
  .refine(
    (task) =>
      Object.values(task.counts).reduce((sum, n) => sum + n, 0) === task.total &&
      (isBatchActive(task.status)
        ? task.endedAt === null && task.counts.queued + task.counts.running > 0
        : task.endedAt !== null && task.counts.queued === 0 && task.counts.running === 0),
  )
export type BatchSummary = z.infer<typeof batchSummarySchema>
export const batchTaskSchema = batchSummarySchema
  .safeExtend({ items: z.array(batchItemSchema).min(1).max(100) })
  .refine(
    (task) =>
      task.items.length === task.total &&
      new Set(task.items.map((item) => item.environmentId)).size === task.total &&
      task.items.every((item, index) => item.ordinal === index) &&
      (isBatchActive(task.status)
        ? task.endedAt === null
        : task.endedAt !== null && task.counts.queued === 0 && task.counts.running === 0) &&
      batchItemStatusSchema.options.every(
        (status) =>
          task.items.filter((item) => item.status === status).length === task.counts[status],
      ),
  )
export type BatchTask = z.infer<typeof batchTaskSchema>
export const batchPageInputSchema = z.strictObject({
  beforeId: batchIdSchema.nullable().default(null),
  limit: z.number().int().min(1).max(50).default(20),
})
export type BatchPageInput = z.infer<typeof batchPageInputSchema>
export const batchPageSchema = workspaceContextSchema
  .extend({
    items: z.array(batchSummarySchema).max(50),
    nextCursor: batchIdSchema.nullable(),
  })
  .refine((page) => page.items.every((item) => item.workspaceId === page.workspaceId))
export type BatchPage = z.infer<typeof batchPageSchema>
