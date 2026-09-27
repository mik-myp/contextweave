import { z } from 'zod'

/** Public identity only: not a path, connection, credential or authorization token. */
export const localWorkspaceSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  kind: z.literal('personal'),
  storageMode: z.literal('local'),
  createdAt: z.string().datetime().length(24),
})
export type LocalWorkspace = z.infer<typeof localWorkspaceSchema>
