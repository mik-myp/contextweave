import { z } from 'zod'

const updateAssetSchema = z
  .object({
    fileName: z.string().min(1),
    url: z.string().url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    sizeBytes: z.number().int().positive().max(800_000_000),
  })
  .strict()
export const appUpdateReleaseSchema = z
  .object({
    version: z.string().min(1),
    url: z.string().url(),
    publishedAt: z.string().datetime(),
    asset: updateAssetSchema.optional(),
  })
  .strict()
export const appUpdateStateSchema = z
  .object({
    phase: z.enum([
      'idle',
      'checking',
      'current',
      'available',
      'unsupported',
      'downloading',
      'ready',
      'cancelled',
      'error',
    ]),
    currentVersion: z.string().min(1),
    checkedAt: z.string().datetime().optional(),
    release: appUpdateReleaseSchema.optional(),
    receivedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    errorCode: z.string().optional(),
  })
  .strict()
export type AppUpdateRelease = z.infer<typeof appUpdateReleaseSchema>
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>
