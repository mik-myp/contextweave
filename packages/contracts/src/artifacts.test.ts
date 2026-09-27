import { describe, it, expect } from 'vitest'
import { artifactRecordSchema, artifactQuerySchema, artifactPageSchema } from './artifacts'
const id = '776c5484-731d-4d25-82d4-3a388986a125'
const identity = {
  dev: '1',
  ino: '18446744073709551615',
  birthtimeNs: '1790467200000000000',
}
const record = {
  artifactId: id,
  environmentId: 'env',
  taskId: 'repeatable',
  allocationName: 'run-123abc',
  bytes: 8,
  sha256: 'a'.repeat(64),
  completedAt: '2026-09-27T00:00:00.000Z',
  ownership: {
    version: 1,
    root: identity,
    directory: identity,
    file: identity,
  },
}
describe('screenshot metadata boundaries', () => {
  it('preserves 64-bit identities as strings and applies bounded query defaults', () => {
    expect(artifactRecordSchema.parse(record)).toEqual(record)
    expect(artifactQuerySchema.parse({})).toEqual({ limit: 20, cursor: null })
  })
  it.each(['../outside', '/root/secret', 'run-123456/x', 'run-12345', 'run-1234567'])(
    'rejects unallocated names: %s',
    (allocationName) => {
      expect(artifactRecordSchema.safeParse({ ...record, allocationName }).success).toBe(false)
    },
  )
  it.each(['bad', '-1', '01', '18446744073709551616', '9'.repeat(100)])(
    'rejects noncanonical or overflowing identities: %s',
    (ino) => {
      expect(
        artifactRecordSchema.safeParse({
          ...record,
          ownership: { ...record.ownership, file: { ...identity, ino } },
        }).success,
      ).toBe(false)
    },
  )
  it.each([
    { limit: 0 },
    { limit: 51 },
    { cursor: { path: '/tmp' } },
    { path: '/tmp' },
    { ids: [id] },
  ])('rejects unsafe queries %j', (query) => {
    expect(artifactQuerySchema.safeParse(query).success).toBe(false)
  })
  it('rejects ownership, arbitrary paths and excessive rows in public responses', () => {
    const { allocationName: _allocation, ownership: _ownership, ...summary } = record
    const item = { ...summary, environmentName: 'Test' }
    const page = {
      items: [item],
      nextCursor: null,
      previousCursor: null,
      totals: { count: 1, bytes: 8 },
    }
    expect(artifactPageSchema.parse(page)).toEqual(page)
    for (const extra of [{ ownership: record.ownership }, { screenshotPath: '/tmp/result.png' }])
      expect(
        artifactPageSchema.safeParse({
          ...page,
          items: [{ ...item, ...extra }],
        }).success,
      ).toBe(false)
    expect(
      artifactPageSchema.safeParse({
        ...page,
        items: Array.from({ length: 51 }, () => item),
      }).success,
    ).toBe(false)
  })
})
