import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createHistoryCleanupService, historyCleanupPreviewTtlMs } from './history-cleanup'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-history-service-'))
  const db = openLocalDatabase(join(root, 'fixture.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
  cleanups.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  let now = Date.parse('2026-09-27T00:00:00.000Z')
  let monotonic = 42
  const clock = { now: () => now, monotonic: () => monotonic }
  const changed = vi.fn()
  const service = createHistoryCleanupService(repository, changed, clock)
  const seed = (id = 'old') => {
    repository.createOperation(id, 'install', null)
    db.sqlite
      .prepare(
        "UPDATE operations SET started_at = '2026-01-01T00:00:00.000Z', ended_at = '2026-01-02T00:00:00.000Z', status = 'succeeded', phase = 'completed' WHERE operation_id = ?",
      )
      .run(id)
  }
  return {
    db,
    repository,
    service,
    clock,
    changed,
    seed,
    advance: (wall: number, mono = wall) => {
      now += wall
      monotonic += mono
    },
  }
}
describe('Main-owned history cleanup batches', () => {
  it('accepts only preset requests and returns no IDs, paths, row payloads or arbitrary delete API', () => {
    const f = fixture()
    f.seed()
    for (const request of [
      { retentionDays: 1 },
      { retentionDays: 90, cutoffAt: '2000' },
      { retentionDays: 90, ids: ['old'] },
    ])
      expect(() => f.service.preview(request)).toThrow()
    const preview = f.service.preview({ retentionDays: 90 })
    expect(preview).toMatchObject({
      retentionDays: 90,
      cutoffAt: '2026-06-29T00:00:00.000Z',
      operations: { count: 1, hasMore: false },
    })
    expect(JSON.stringify(preview)).not.toContain('old')
    expect(() => f.service.confirm({ previewId: preview.previewId, ids: ['old'] })).toThrow()
    expect(f.repository.listOperations()).toHaveLength(1)
  })
  it('replaces the previous batch, refuses unknown IDs, and requires a fresh user confirmation', () => {
    const f = fixture()
    f.seed()
    const old = f.service.preview({ retentionDays: 30 })
    const next = f.service.preview({ retentionDays: 90 })
    expect(() => f.service.confirm({ previewId: old.previewId })).toThrow(
      'HISTORY_CLEANUP_PREVIEW_INVALID',
    )
    expect(() => f.service.confirm({ previewId: randomUUID() })).toThrow(
      'HISTORY_CLEANUP_PREVIEW_INVALID',
    )
    expect(f.service.confirm({ previewId: next.previewId }).receipt.operations.deleted).toBe(1)
  })
  it.each(['wall', 'monotonic', 'backwards-wall'] as const)(
    'expires on %s time and never renews an old batch on retry',
    (kind) => {
      const f = fixture()
      f.seed()
      const preview = f.service.preview({ retentionDays: 90 })
      f.advance(
        kind === 'wall'
          ? historyCleanupPreviewTtlMs
          : kind === 'backwards-wall'
            ? -historyCleanupPreviewTtlMs
            : 0,
        kind === 'wall' ? 0 : historyCleanupPreviewTtlMs,
      )
      expect(() => f.service.confirm({ previewId: preview.previewId })).toThrow(
        'HISTORY_CLEANUP_PREVIEW_EXPIRED',
      )
      expect(() => f.service.confirm({ previewId: preview.previewId })).toThrow(
        'HISTORY_CLEANUP_PREVIEW_INVALID',
      )
      expect(f.repository.listOperations()).toHaveLength(1)
      expect(f.service.receipt()).toBeNull()
    },
  )
  it('identifies a duplicate, lost response and service restart using only the latest committed receipt', () => {
    const f = fixture()
    f.seed()
    const preview = f.service.preview({ retentionDays: 90 })
    const result = f.service.confirm({ previewId: preview.previewId })
    f.seed('later')
    f.advance(historyCleanupPreviewTtlMs * 2)
    expect(f.service.confirm({ previewId: preview.previewId })).toEqual({
      ...result,
      replayed: true,
    })
    const restarted = createHistoryCleanupService(f.repository, f.changed, f.clock)
    expect(restarted.receipt()).toEqual(result.receipt)
    expect(restarted.confirm({ previewId: preview.previewId })).toEqual({
      ...result,
      replayed: true,
    })
    expect(f.repository.listOperations().map((row) => row.operationId)).toEqual(['later'])
    const next = restarted.preview({ retentionDays: 90 })
    restarted.confirm({ previewId: next.previewId })
    expect(() => restarted.confirm({ previewId: preview.previewId })).toThrow(
      'HISTORY_CLEANUP_PREVIEW_INVALID',
    )
    expect(f.changed).toHaveBeenCalledWith(['activity', 'operations', 'storage'])
  })
  it('does not overwrite the committed receipt for empty or failed attempts', () => {
    const f = fixture()
    f.seed()
    const first = f.service.preview({ retentionDays: 90 })
    const result = f.service.confirm({ previewId: first.previewId })
    const empty = f.service.preview({ retentionDays: 90 })
    expect(() => f.service.confirm({ previewId: empty.previewId })).toThrow('HISTORY_CLEANUP_EMPTY')
    f.seed('next')
    const next = f.service.preview({ retentionDays: 90 })
    f.db.sqlite.exec(
      "CREATE TRIGGER deny_history_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT, 'fixture denial'); END",
    )
    expect(() => f.service.confirm({ previewId: next.previewId })).toThrow('fixture denial')
    expect(f.service.receipt()).toEqual(result.receipt)
    expect(f.repository.listOperations()).toHaveLength(1)
    f.db.sqlite.exec('DROP TRIGGER deny_history_delete')
    expect(f.service.confirm({ previewId: next.previewId }).receipt.operations.deleted).toBe(1)
  })
  it('can verify a committed deletion even if event delivery failed after COMMIT', () => {
    const f = fixture()
    f.seed()
    const preview = f.service.preview({ retentionDays: 90 })
    f.changed.mockImplementationOnce(() => {
      throw new Error('event delivery failure')
    })
    expect(() => f.service.confirm({ previewId: preview.previewId })).toThrow(
      'event delivery failure',
    )
    expect(f.service.receipt()?.previewId).toBe(preview.previewId)
    f.seed('later')
    expect(f.service.confirm({ previewId: preview.previewId }).replayed).toBe(true)
    expect(f.repository.listOperations()).toHaveLength(1)
  })
})
