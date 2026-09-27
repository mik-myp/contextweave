import { z } from 'zod'

export const artifactPageLimit = 50
export const maxArtifactBytes = 32 * 1024 * 1024
const timestamp = z.string().datetime().length(24)
const artifactId = z.string().uuid()
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const uint64 = z
  .string()
  .max(20)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) =>
      value.length <= 20 && /^[0-9]+$/.test(value) && BigInt(value) <= 18446744073709551615n,
  )
const identity = z.strictObject({
  dev: uint64,
  ino: uint64,
  birthtimeNs: uint64,
})

// Main/storage only. Public read models deliberately exclude all ownership/location fields.
export const artifactRecordSchema = z.strictObject({
  artifactId,
  environmentId: z.string().trim().min(1).max(200),
  taskId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  allocationName: z.string().regex(/^run-[a-zA-Z0-9]{6}$/),
  bytes: z.number().int().min(8).max(maxArtifactBytes),
  sha256,
  completedAt: timestamp,
  ownership: z.strictObject({
    version: z.literal(1),
    root: identity,
    directory: identity,
    file: identity,
  }),
})
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>
export const artifactCursorSchema = z.strictObject({
  completedAt: timestamp,
  artifactId,
  side: z.enum(['previous', 'next']),
})
export const artifactQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(artifactPageLimit).default(20),
  cursor: artifactCursorSchema.nullable().default(null),
})
export type ArtifactQuery = z.infer<typeof artifactQuerySchema>
export const artifactSummarySchema = artifactRecordSchema
  .pick({
    artifactId: true,
    environmentId: true,
    taskId: true,
    bytes: true,
    sha256: true,
    completedAt: true,
  })
  .extend({ environmentName: z.string().max(100) })
  .strict()
export const artifactPageSchema = z.strictObject({
  items: z.array(artifactSummarySchema).max(artifactPageLimit),
  previousCursor: artifactCursorSchema.nullable(),
  nextCursor: artifactCursorSchema.nullable(),
  totals: z.strictObject({
    count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
})
export type ArtifactPage = z.infer<typeof artifactPageSchema>
