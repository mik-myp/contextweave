import { describe, expect, it } from 'vitest'
import {
  historyCleanupRequestSchema,
  historyCleanupConfirmSchema,
  historyCleanupPreviewSchema,
  historyCleanupReceiptSchema,
  historyCleanupResultSchema,
} from './history-cleanup'

const scope = {
  previewId: 'e4c3b366-6342-4630-b533-93ec809bafce',
  retentionDays: 90,
  cutoffAt: '2026-06-29T00:00:00.000Z',
}
const preview = {
  ...scope,
  createdAt: '2026-09-27T00:00:00.000Z',
  expiresAt: '2026-09-27T00:05:00.000Z',
  sessions: { count: 500, hasMore: true },
  operations: { count: 0, hasMore: false },
}
const receipt = {
  ...scope,
  completedAt: '2026-09-27T00:01:00.000Z',
  sessions: { selected: 500, deleted: 499, skipped: 1 },
  operations: { selected: 0, deleted: 0, skipped: 0 },
}
describe('explicit bounded history cleanup contracts', () => {
  it('accepts only retention presets, never caller-selected cutoffs, SQL or deletion IDs', () => {
    for (const retentionDays of [30, 90, 180, 365])
      expect(historyCleanupRequestSchema.parse({ retentionDays })).toEqual({ retentionDays })
    for (const input of [
      {},
      { retentionDays: 0 },
      { retentionDays: '90' },
      { retentionDays: 90, cutoffAt: scope.cutoffAt },
      { retentionDays: 90, ids: [] },
    ])
      expect(historyCleanupRequestSchema.safeParse(input).success).toBe(false)
    expect(historyCleanupConfirmSchema.parse({ previewId: scope.previewId })).toEqual({
      previewId: scope.previewId,
    })
    for (const input of [
      { previewId: 'raw-row-id' },
      { previewId: scope.previewId, ids: [] },
      { previewId: scope.previewId, sql: 'DELETE' },
    ])
      expect(historyCleanupConfirmSchema.safeParse(input).success).toBe(false)
  })
  it('rejects oversized or contradictory previews and invalid calendar dates', () => {
    expect(historyCleanupPreviewSchema.parse(preview)).toEqual(preview)
    for (const patch of [
      { sessions: { count: 501, hasMore: true } },
      { sessions: { count: 499, hasMore: true } },
      { operations: { count: -1, hasMore: false } },
      { expiresAt: preview.createdAt },
      { createdAt: '2026-09-31T00:00:00.000Z' },
      { cutoffAt: '2026-06-28T00:00:00.000Z' },
      { cutoffAt: '2026-06-29T00:00:00Z' },
      { candidates: ['s-secret'] },
    ])
      expect(historyCleanupPreviewSchema.safeParse({ ...preview, ...patch }).success).toBe(false)
  })
  it('keeps a bounded non-secret receipt with checked arithmetic and an explicit replay flag', () => {
    expect(historyCleanupReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(historyCleanupResultSchema.parse({ receipt, replayed: true })).toEqual({
      receipt,
      replayed: true,
    })
    for (const patch of [
      { sessions: { selected: 500, deleted: 500, skipped: 1 } },
      { sessions: { selected: 501, deleted: 501, skipped: 0 } },
      { path: '/secret' },
    ])
      expect(historyCleanupReceiptSchema.safeParse({ ...receipt, ...patch }).success).toBe(false)
    expect(historyCleanupResultSchema.safeParse({ receipt }).success).toBe(false)
  })
})
