import { expect, it } from 'vitest'
import { localWorkspaceSchema } from './workspaces'
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
