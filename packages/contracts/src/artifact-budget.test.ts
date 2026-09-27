import { describe, expect, it } from 'vitest'
import {
  artifactBudgetSchema,
  artifactBudgetUpdateSchema,
  artifactReservationSchema,
  maxArtifactBytes,
} from './index'

describe('screenshot budget contracts', () => {
  it('bounds policy inputs and rejects hidden release/path fields', () => {
    for (const limitMiB of [32, 1024, 102400])
      expect(artifactBudgetUpdateSchema.parse({ limitMiB, expectedRevision: 1 }).limitMiB).toBe(
        limitMiB,
      )
    for (const input of [
      { limitMiB: 31, expectedRevision: 1 },
      { limitMiB: 102401, expectedRevision: 1 },
      { limitMiB: 32.5, expectedRevision: 1 },
      { limitMiB: 32, expectedRevision: 0 },
      { limitMiB: 32, expectedRevision: 1, releaseIds: ['anything'] },
      { limitMiB: Infinity, expectedRevision: 1 },
    ])
      expect(artifactBudgetUpdateSchema.safeParse(input).success).toBe(false)
  })
  it('requires internally consistent accounting, including over-budget and uncertain reservations', () => {
    const value = {
      limitMiB: 32,
      revision: 1,
      registered: { count: 1, bytes: 8 },
      reserved: { count: 1, bytes: maxArtifactBytes },
      availableBytes: 0,
    }
    expect(artifactBudgetSchema.safeParse(value).success).toBe(true)
    for (const invalid of [
      { ...value, availableBytes: 1 },
      { ...value, reserved: { count: 2, bytes: maxArtifactBytes } },
      { ...value, ownership: {} },
      { ...value, registered: { count: 1, bytes: Number.MAX_SAFE_INTEGER } },
    ])
      expect(artifactBudgetSchema.safeParse(invalid).success).toBe(false)
    expect(
      artifactReservationSchema.safeParse({
        artifactId: 'task-id',
        environmentId: 'env',
        taskId: 'task',
        reservedAt: '2026-09-27T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })
})
