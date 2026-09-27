import { describe, it, expect } from 'vitest'
import {
  batchPreviewInputSchema,
  batchPreviewSchema,
  batchTaskSchema,
  batchPageSchema,
  batchPageInputSchema,
} from './batches'
const owner = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const time = '2026-01-01T00:00:00.000Z'
const task = {
  workspaceId: owner,
  id,
  action: 'start',
  status: 'completed',
  sourceTaskId: null,
  createdAt: time,
  endedAt: time,
  total: 1,
  counts: {
    queued: 0,
    running: 0,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    unknown: 0,
  },
  items: [
    {
      environmentId: 'env-a',
      name: 'Example',
      revision: 1,
      ordinal: 0,
      status: 'succeeded',
      reason: null,
      startedAt: time,
      endedAt: time,
    },
  ],
}
describe('batch contracts', () => {
  it('bounds unique explicit targets and disallows client-supplied feasibility', () => {
    expect(
      batchPreviewInputSchema.parse({
        action: 'stop',
        environmentIds: ['env-a'],
      }),
    ).toEqual({ action: 'stop', environmentIds: ['env-a'] })
    for (const environmentIds of [
      [],
      ['a', 'a'],
      [' a', 'a'],
      Array.from({ length: 101 }, (_, i) => `env-${i}`),
    ])
      expect(batchPreviewInputSchema.safeParse({ action: 'start', environmentIds }).success).toBe(
        false,
      )
    expect(
      batchPreviewInputSchema.safeParse({
        action: 'delete',
        environmentIds: ['a'],
      }).success,
    ).toBe(false)
    expect(
      batchPreviewInputSchema.safeParse({
        action: 'start',
        environmentIds: ['a'],
        eligible: true,
      }).success,
    ).toBe(false)
  })
  it('rejects contradictory/mixed-owner facts and unknown result fields', () => {
    expect(batchTaskSchema.parse(task)).toEqual(task)
    expect(
      batchTaskSchema.safeParse({
        ...task,
        counts: { ...task.counts, failed: 1 },
      }).success,
    ).toBe(false)
    expect(
      batchTaskSchema.safeParse({
        ...task,
        items: [{ ...task.items[0], status: 'queued' }],
      }).success,
    ).toBe(false)
    expect(
      batchTaskSchema.safeParse({
        ...task,
        items: [{ ...task.items[0], result: 'secret' }],
      }).success,
    ).toBe(false)
    const { items: _items, ...summary } = task
    expect(
      batchPageSchema.safeParse({
        workspaceId: '00000000-0000-4000-8000-000000000003',
        items: [summary],
        nextCursor: null,
      }).success,
    ).toBe(false)
  })
  it('requires a revision or an explicit missing reason in previews', () => {
    const preview = {
      workspaceId: owner,
      id,
      action: 'start',
      sourceTaskId: null,
      createdAt: time,
      expiresAt: time,
      targets: [{ environmentId: 'a', name: '', revision: null, reason: null }],
    }
    expect(batchPreviewSchema.safeParse(preview).success).toBe(false)
    expect(
      batchPreviewSchema.safeParse({
        ...preview,
        targets: [{ ...preview.targets[0], reason: 'NOT_FOUND' }],
      }).success,
    ).toBe(true)
    expect(
      batchPreviewSchema.safeParse({
        ...preview,
        targets: [{ ...preview.targets[0], revision: 1, reason: 'token=secret' }],
      }).success,
    ).toBe(false)
  })
  it('bounds cursor pages and does not accept arbitrary offsets or SQL', () => {
    expect(batchPageInputSchema.parse({})).toEqual({
      beforeId: null,
      limit: 20,
    })
    for (const input of [{ limit: 51 }, { limit: 0 }, { beforeId: "' OR 1=1" }, { offset: 50 }])
      expect(batchPageInputSchema.safeParse(input).success).toBe(false)
  })
})
