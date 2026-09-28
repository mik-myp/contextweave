import { z } from 'zod'
import { deleteTagSchema } from './organization'

export const managedKernelIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(200)
export const kernelDisplayNameSchema = z
  .string()
  .trim()
  .max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))
export const installKernelSchema = z.strictObject({
  id: managedKernelIdSchema,
  name: kernelDisplayNameSchema.optional(),
})
export const BULK_DELETE_LIMIT = 200
export const renameKernelSchema = z.strictObject({
  id: managedKernelIdSchema,
  // An empty name restores the provider's display name. IDs and version bindings never change.
  name: kernelDisplayNameSchema,
})
export const deleteKernelsSchema = z
  .array(managedKernelIdSchema)
  .min(1)
  .max(BULK_DELETE_LIMIT)
  .refine((items) => new Set(items).size === items.length, 'Duplicate IDs')
export const deleteTagsSchema = z
  .array(deleteTagSchema)
  .min(1)
  .max(BULK_DELETE_LIMIT)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate IDs')
export const bulkDeleteResultSchema = z
  .array(
    z.discriminatedUnion('ok', [
      z.strictObject({ id: z.string().min(1), ok: z.literal(true) }),
      z.strictObject({
        id: z.string().min(1),
        ok: z.literal(false),
        code: z.string().regex(/^[A-Z][A-Z_]+$/),
      }),
    ]),
  )
  .max(BULK_DELETE_LIMIT)
export type BulkDeleteResult = z.infer<typeof bulkDeleteResultSchema>
