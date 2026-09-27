import { expect, it } from 'vitest'
import {
  localWorkspaceSchema,
  workspaceContextSchema,
  workspaceCommandSchema,
  workspaceCredentialReferenceSchema,
  assertWorkspaceContext,
} from './workspaces'
const identity = {
  workspaceId: 'd326147b-89da-40fa-8cc0-7b9ad0dfacb6',
  kind: 'personal',
  storageMode: 'local',
  createdAt: '2026-09-27T00:00:00.000Z',
}
it('accepts only the persisted local personal public identity', () => {
  expect(localWorkspaceSchema.parse(identity)).toEqual(identity)
})
it.each([
  { workspaceId: '../another-space' },
  { workspaceId: '' },
  { kind: 'team' },
  { storageMode: 'postgresql' },
  { createdAt: 'invalid' },
  { dataRoot: '/private/example' },
  { credentialRef: 'private-reference' },
  { connectionString: 'not-a-public-field' },
])('rejects malformed, remote or private identity fields: %j', (change) => {
  expect(localWorkspaceSchema.safeParse({ ...identity, ...change }).success).toBe(false)
})

it('requires an explicit, strict context and never substitutes a local default', () => {
  const context = { workspaceId: identity.workspaceId }
  expect(workspaceContextSchema.parse(context)).toEqual(context)
  expect(workspaceCommandSchema.parse({ ...context, payload: undefined })).toEqual({
    ...context,
    payload: undefined,
  })
  for (const input of [
    undefined,
    null,
    {},
    { payload: 'same-id' },
    { ...context, payload: 'same-id', path: '/other' },
  ])
    expect(workspaceCommandSchema.safeParse(input).success).toBe(false)
  expect(() =>
    assertWorkspaceContext(context, { workspaceId: '00000000-0000-4000-8000-000000000001' }),
  ).toThrow('WORKSPACE_MISMATCH')
})
it('preserves opaque legacy credential keys while requiring ownership and rejecting private fields', () => {
  const key = 'legacy-' + 'x'.repeat(1024)
  const reference = { workspaceId: identity.workspaceId, reference: key }
  expect(workspaceCredentialReferenceSchema.parse(reference)).toEqual(reference)
  expect(
    workspaceCredentialReferenceSchema.safeParse({ ...reference, password: 'not-a-reference' })
      .success,
  ).toBe(false)
  expect(workspaceCredentialReferenceSchema.safeParse(key).success).toBe(false)
})
