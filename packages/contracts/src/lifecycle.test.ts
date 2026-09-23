import { expect, it } from 'vitest'
import { capabilityEvidenceSchema, dataChangedSchema } from './lifecycle'
it('requires evidence instead of treating a declaration as verified capability', () => {
  expect(capabilityEvidenceSchema.safeParse({ declared: true, state: 'verified' }).success).toBe(
    false,
  )
  expect(capabilityEvidenceSchema.safeParse({ declared: true, state: 'unverified' }).success).toBe(
    true,
  )
  expect(
    capabilityEvidenceSchema.safeParse({
      declared: true,
      state: 'verified',
      version: '123.0.0.1',
      checkedAt: new Date().toISOString(),
      evidence: 'local CDP handshake',
    }).success,
  ).toBe(true)
})
it('restricts cache invalidation events to known local domains', () => {
  expect(dataChangedSchema.safeParse({ domains: ['environments', 'activity'] }).success).toBe(true)
  expect(dataChangedSchema.safeParse({ domains: ['arbitrary:channel'] }).success).toBe(false)
})
