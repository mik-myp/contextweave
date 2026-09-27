import { z } from 'zod'
import { artifactRecordSchema, maxArtifactBytes } from './artifacts'

export const bytesPerMiB = 1024 * 1024
export const defaultArtifactBudgetMiB = 1024
export const artifactBudgetMiBSchema = z.number().int().min(32).max(102400)
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const countAndBytes = z.strictObject({
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
export const artifactBudgetUpdateSchema = z.strictObject({
  limitMiB: artifactBudgetMiBSchema,
  expectedRevision: revision,
})
export const artifactBudgetSchema = z
  .strictObject({
    limitMiB: artifactBudgetMiBSchema,
    revision,
    registered: countAndBytes,
    reserved: countAndBytes,
    availableBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    (value) =>
      Number.isSafeInteger(value.registered.bytes + value.reserved.bytes) &&
      value.registered.bytes >= value.registered.count * 8 &&
      value.registered.bytes <= value.registered.count * maxArtifactBytes &&
      value.reserved.bytes === value.reserved.count * maxArtifactBytes &&
      value.availableBytes ===
        Math.max(0, value.limitMiB * bytesPerMiB - value.registered.bytes - value.reserved.bytes),
  )
export type ArtifactBudget = z.infer<typeof artifactBudgetSchema>
export type ArtifactBudgetUpdate = z.infer<typeof artifactBudgetUpdateSchema>

// Internal only: neither allocation evidence nor reservation identities are writable over IPC.
export const artifactReservationSchema = artifactRecordSchema
  .pick({
    artifactId: true,
    environmentId: true,
    taskId: true,
  })
  .extend({ reservedAt: z.string().datetime().length(24) })
  .strict()
export type ArtifactReservation = z.infer<typeof artifactReservationSchema>
export const artifactAllocationSchema = artifactRecordSchema
  .pick({
    artifactId: true,
    allocationName: true,
    ownership: true,
  })
  .strict()
export type ArtifactAllocation = z.infer<typeof artifactAllocationSchema>
