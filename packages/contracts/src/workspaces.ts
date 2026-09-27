import { z } from 'zod'

/** Public identity only: not a path, connection, credential or authorization token. */
export const localWorkspaceSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  kind: z.literal('personal'),
  storageMode: z.literal('local'),
  createdAt: z.string().datetime().length(24),
})
export type LocalWorkspace = z.infer<typeof localWorkspaceSchema>

/** A public ownership label, never a substitute for authorization or a filesystem path. */
export const workspaceContextSchema = localWorkspaceSchema.pick({ workspaceId: true })
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>

export const workspaceCommandSchema = workspaceContextSchema.extend({ payload: z.unknown() })
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>

/** The encrypted file retains its existing opaque key; context must be checked before using it. */
export const workspaceCredentialReferenceSchema = workspaceContextSchema.extend({
  reference: z.string().min(1),
})
export type WorkspaceCredentialReference = z.infer<typeof workspaceCredentialReferenceSchema>

export function assertWorkspaceContext(
  expected: WorkspaceContext,
  input: unknown,
): WorkspaceContext {
  const parsed = workspaceContextSchema.safeParse(input)
  if (!parsed.success) throw new Error('WORKSPACE_CONTEXT_INVALID')
  if (parsed.data.workspaceId !== expected.workspaceId) throw new Error('WORKSPACE_MISMATCH')
  return parsed.data
}
