import { describe, expect, it } from 'vitest'
import {
  commandIntentDigestSchema,
  environmentCommandReceiptSchema,
  environmentCommandReferenceSchema,
  isEnvironmentCommandActive,
} from './commands'
const at = '2026-09-27T00:00:00.000Z'
const queued = {
  workspaceId: '827b8ddc-bbce-4fe2-93e8-5248bc7a6c12',
  version: 1,
  requestId: '55a315bb-a3ec-41d0-9419-62625bd33fbf',
  kind: 'start',
  environmentId: 'env-test',
  expectedRevision: 1,
  status: 'queued',
  createdAt: at,
  startedAt: null,
  endedAt: null,
  errorCode: null,
}
const accepts = (change: Record<string, unknown>) =>
  environmentCommandReceiptSchema.safeParse({ ...queued, ...change }).success

describe('durable environment command facts', () => {
  it('requires explicit owner, request identity, target and protocol version', () => {
    expect(accepts({})).toBe(true)
    for (const field of ['workspaceId', 'requestId', 'environmentId', 'version'])
      expect(accepts({ [field]: undefined })).toBe(false)
    expect(accepts({ version: 2 })).toBe(false)
  })
  it('does not put intent bodies, hashes, paths or arbitrary outcomes on the public receipt', () => {
    for (const field of ['intentDigest', 'payload', 'dataDir', 'config', 'credential', 'result'])
      expect(accepts({ [field]: 'must-not-cross-boundary' })).toBe(false)
  })
  it('distinguishes allocated creation identity from revision-checked existing resources', () => {
    expect(accepts({ kind: 'create', expectedRevision: null })).toBe(true)
    expect(accepts({ kind: 'create' })).toBe(false)
    expect(accepts({ expectedRevision: null })).toBe(false)
    expect(
      environmentCommandReferenceSchema.safeParse({
        environmentId: 'env-test',
        expectedRevision: 0,
      }).success,
    ).toBe(false)
    expect(
      environmentCommandReferenceSchema.safeParse({
        environmentId: 'env-test',
        expectedRevision: 2,
      }).success,
    ).toBe(true)
  })
  it('only has active queued/running states', () => {
    expect(isEnvironmentCommandActive('queued')).toBe(true)
    expect(isEnvironmentCommandActive('running')).toBe(true)
    expect(isEnvironmentCommandActive('unknown')).toBe(false)
    expect(isEnvironmentCommandActive('cancelled')).toBe(false)
  })
  it.each([
    { startedAt: at },
    { endedAt: at },
    { errorCode: 'COMMAND_FAILED' },
    { status: 'running' },
    { status: 'running', startedAt: at, endedAt: at },
    { status: 'succeeded', endedAt: at },
    { status: 'succeeded', startedAt: at, endedAt: at, errorCode: 'COMMAND_FAILED' },
    { status: 'failed', endedAt: at, errorCode: 'COMMAND_INTERRUPTED' },
    { status: 'unknown', endedAt: at, errorCode: 'COMMAND_INTERRUPTED' },
    { status: 'unknown', startedAt: at, endedAt: at, errorCode: 'CONFIG_CONFLICT' },
    { status: 'cancelled', endedAt: at, errorCode: 'COMMAND_FAILED' },
    { status: 'failed', endedAt: at, errorCode: 'arbitrary private error text' },
  ])('rejects inconsistent or ambiguous facts instead of calling them success: %j', (change) => {
    expect(accepts(change)).toBe(false)
  })
  it('retains explicit success, definite failure, cancellation and unknown outcomes', () => {
    expect(accepts({ status: 'running', startedAt: at })).toBe(true)
    expect(accepts({ status: 'succeeded', startedAt: at, endedAt: at })).toBe(true)
    expect(accepts({ status: 'failed', endedAt: at, errorCode: 'CONFIG_CONFLICT' })).toBe(true)
    expect(accepts({ status: 'cancelled', endedAt: at, errorCode: 'CANCELLED' })).toBe(true)
    expect(
      accepts({ status: 'unknown', startedAt: at, endedAt: at, errorCode: 'COMMAND_INTERRUPTED' }),
    ).toBe(true)
  })
  it('keeps the internal intent digest bounded and canonical', () => {
    expect(commandIntentDigestSchema.safeParse('a'.repeat(64)).success).toBe(true)
    expect(commandIntentDigestSchema.safeParse('A'.repeat(64)).success).toBe(false)
    expect(commandIntentDigestSchema.safeParse('a'.repeat(65)).success).toBe(false)
  })
})

it('canonicalizes UUID request identity so letter case cannot cause another execution', () => {
  const original = environmentCommandReceiptSchema.parse(queued)
  expect(
    environmentCommandReceiptSchema.parse({ ...queued, requestId: queued.requestId.toUpperCase() })
      .requestId,
  ).toBe(original.requestId)
})
