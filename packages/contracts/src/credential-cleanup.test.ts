import { describe, expect, it } from 'vitest'
import { credentialCleanupStatusSchema, ipcResultSchema } from './index'
describe('credential cleanup contract', () => {
  it('accepts only nonnegative counts and a temporary-file maintenance flag', () => {
    expect(
      credentialCleanupStatusSchema.parse({ pendingCount: 2, temporaryFilesPending: false }),
    ).toEqual({ pendingCount: 2, temporaryFilesPending: false })
  })
  it.each([
    { pendingCount: -1, temporaryFilesPending: false },
    { pendingCount: 0.5, temporaryFilesPending: false },
    { pendingCount: '1', temporaryFilesPending: false },
    { pendingCount: 1 },
    { pendingCount: 1, temporaryFilesPending: false, credentialRef: 'secret-reference' },
    { pendingCount: 1, temporaryFilesPending: false, filePath: '/private/path' },
  ])('rejects invalid or secret-bearing responses: %j', (data) => {
    expect(
      ipcResultSchema(credentialCleanupStatusSchema).safeParse({ ok: true, data }).success,
    ).toBe(false)
  })
})
