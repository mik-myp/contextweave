import { z } from 'zod'
import { workspaceContextSchema } from './workspaces'

export const maxDefaultBookmarks = 200
export const bookmarkSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => {
      // Reject normalized-away credentials/control characters as well as parsed userinfo.
      if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return false
      try {
        const url = new URL(value)
        const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/u)[0]!
        return Boolean(url.hostname) && !url.username && !url.password && !authority.includes('@')
      } catch {
        return false
      }
    }, 'An HTTP(S) URL without embedded credentials is required'),
})
export type Bookmark = z.infer<typeof bookmarkSchema>
export const defaultBookmarkListSchema = z
  .array(bookmarkSchema)
  .max(maxDefaultBookmarks)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Bookmark IDs must be unique',
  )
export const defaultBookmarksSchema = workspaceContextSchema.extend({
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  items: defaultBookmarkListSchema,
})
export type DefaultBookmarks = z.infer<typeof defaultBookmarksSchema>
export const saveDefaultBookmarksSchema = z.strictObject({
  expectedRevision: defaultBookmarksSchema.shape.revision,
  items: defaultBookmarkListSchema,
})
export type SaveDefaultBookmarks = z.infer<typeof saveDefaultBookmarksSchema>
