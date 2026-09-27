import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { environmentConfigSchema, historyCleanupPreviewSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from './index'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn()
})
const cutoffAt = '2026-06-29T00:00:00.000Z'
const now = '2026-09-27T00:00:00.000Z'
function fixture(file = ':memory:') {
  const db = openLocalDatabase(file)
  let closed = false
  const close = () => {
    if (!closed) {
      closed = true
      db.close()
    }
  }
  cleanup.push(close)
  const repo = new EnvironmentRepository(db.sqlite)
  const environment = (id = 'env') =>
    repo.create({
      config: environmentConfigSchema.parse({
        environmentId: id,
        name: id,
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
      }),
      dataDir: '/fixture-only/untouched-profile',
      platform: 'darwin',
      arch: 'arm64',
    })
  if (!repo.get('env')) environment()
  const session = (id: string, env = 'env', version?: string) =>
    repo.createRuntimeSession({
      sessionId: id,
      environmentId: env,
      pid: 42,
      controlPort: 9000,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-02T00:00:00.000Z',
      status: 'stopped',
      phase: 'ended',
      exitReason: null,
      executableVersion: version,
    })
  const operation = (id: string, env: string | null = 'env') => {
    repo.createOperation(id, 'start', env)
    db.sqlite
      .prepare(
        "UPDATE operations SET status = 'succeeded', phase = 'completed', started_at = ?, ended_at = ? WHERE operation_id = ?",
      )
      .run('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', id)
  }
  const preview = () => {
    const candidates = repo.previewHistoryCleanup(cutoffAt)
    return {
      candidates,
      preview: historyCleanupPreviewSchema.parse({
        previewId: randomUUID(),
        retentionDays: 90,
        cutoffAt,
        createdAt: now,
        expiresAt: '2026-09-27T00:05:00.000Z',
        sessions: { count: candidates.sessions.length, hasMore: candidates.moreSessions },
        operations: { count: candidates.operations.length, hasMore: candidates.moreOperations },
      }),
    }
  }
  return { db, repo, close, environment, session, operation, preview }
}
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id)

describe('bounded history cleanup storage', () => {
  it('protects exactly the last nonempty executable version used by compatibility, including ties', () => {
    const f = fixture()
    f.session('a', 'env', '148.0.0.1')
    f.session('z', 'env', '148.0.0.2')
    f.session('zz', 'env', '')
    f.session('zzz')
    f.operation('done')
    expect(f.repo.latestExecutableVersion('env')).toBe('148.0.0.2')
    const { preview, candidates } = f.preview()
    expect(ids(candidates.sessions)).toEqual(['a', 'zz', 'zzz'])
    const result = f.repo.commitHistoryCleanup(preview, candidates, now)
    expect(result.receipt.sessions).toEqual({ selected: 3, deleted: 3, skipped: 0 })
    expect(f.repo.latestExecutableVersion('env')).toBe('148.0.0.2')
    expect(f.repo.get('env')?.revision).toBe(1)
    expect(f.repo.getRevision('env', 1)).toBeDefined()
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
  })

  it.each(['starting', 'running', 'stopping', 'needs-recovery'] as const)(
    'protects both history kinds for %s environments',
    (status) => {
      const f = fixture()
      f.session('s')
      f.operation('o')
      f.repo.updateStatus('env', status)
      expect(f.preview().candidates).toMatchObject({ sessions: [], operations: [] })
    },
  )
  it('protects history if a session or a command is active even when environment status lags', () => {
    const f = fixture()
    f.session('old')
    f.operation('old-op')
    f.session('live')
    f.db.sqlite.exec("UPDATE runtime_sessions SET status = 'running' WHERE session_id = 'live'")
    expect(f.preview().candidates).toMatchObject({ sessions: [], operations: [] })
    f.db.sqlite.exec("DELETE FROM runtime_sessions WHERE session_id = 'live'")
    f.repo.createOperation('pending', 'start', 'env')
    expect(f.preview().candidates).toMatchObject({ sessions: [], operations: [] })
    // Operations can legitimately target a missing environment, a kernel, or no target at all.
    f.operation('kernel-op', 'kernel-local')
    f.operation('missing-op', 'missing')
    f.operation('null-op', null)
    expect(ids(f.preview().candidates.operations)).toEqual(['kernel-op', 'missing-op', 'null-op'])
  })

  it('preserves incomplete, malformed, ambiguous and interrupted rows and the exact age boundary', () => {
    const f = fixture()
    const patches = [
      'ended_at = NULL',
      "ended_at = 'not-a-date'",
      "started_at = 'not-a-date'",
      "ended_at = '2026-02-30T00:00:00.000Z'",
      "started_at = '2026-02-30T00:00:00.000Z'",
      "ended_at = '2025-12-31T00:00:00.000Z'",
      `ended_at = '${cutoffAt}'`,
      "ended_at = '2026-01-02T00:00:00Z'",
      "phase = 'interrupted'",
    ]
    patches.forEach((patch, i) => {
      f.session(`s-${i}`)
      f.operation(`o-${i}`)
      f.db.sqlite.exec(
        `UPDATE runtime_sessions SET ${patch} WHERE session_id = 's-${i}'; UPDATE operations SET ${patch} WHERE operation_id = 'o-${i}'`,
      )
    })
    f.session('interrupted')
    f.db.sqlite.exec(
      "UPDATE runtime_sessions SET exit_reason = 'CLIENT_INTERRUPTED' WHERE session_id = 'interrupted'",
    )
    f.operation('interrupted-op')
    f.db.sqlite.exec(
      "UPDATE operations SET status = 'failed', phase = 'completed', error_code = 'CLIENT_INTERRUPTED' WHERE operation_id = 'interrupted-op'",
    )
    f.operation('ambiguous-failure')
    f.db.sqlite.exec(
      "UPDATE operations SET status = 'failed' WHERE operation_id = 'ambiguous-failure'",
    )
    f.operation('ambiguous-success')
    f.db.sqlite.exec(
      "UPDATE operations SET error_code = 'ERROR' WHERE operation_id = 'ambiguous-success'",
    )
    f.session('valid')
    f.operation('valid')
    f.operation('failure')
    f.operation('cancelled')
    f.db.sqlite.exec(
      "UPDATE operations SET status = 'failed', phase = 'failed', error_code = 'COMMAND_FAILED' WHERE operation_id = 'failure'; UPDATE operations SET status = 'cancelled', error_code = 'CANCELLED' WHERE operation_id = 'cancelled'",
    )
    expect(ids(f.preview().candidates.sessions)).toEqual(['valid'])
    expect(ids(f.preview().candidates.operations)).toEqual(['cancelled', 'failure', 'valid'])
  })

  it('caps each kind at 500, detects a further batch, and never auto-continues or expands candidates', () => {
    const f = fixture()
    f.db.sqlite.exec('BEGIN')
    for (let i = 0; i < 503; i++) {
      f.session(`s-${String(i).padStart(4, '0')}`)
      f.operation(`o-${String(i).padStart(4, '0')}`)
    }
    f.db.sqlite.exec('COMMIT')
    const { preview, candidates } = f.preview()
    expect(preview.sessions).toEqual({ count: 500, hasMore: true })
    expect(preview.operations).toEqual({ count: 500, hasMore: true })
    f.session('new-old-session')
    f.operation('new-old-operation')
    const result = f.repo.commitHistoryCleanup(preview, candidates, now)
    expect(result.receipt.sessions).toEqual({ selected: 500, deleted: 500, skipped: 0 })
    expect(result.receipt.operations).toEqual({ selected: 500, deleted: 500, skipped: 0 })
    expect(f.repo.commitHistoryCleanup(preview, candidates, now)).toEqual({
      ...result,
      replayed: true,
    })
    expect(f.preview().preview).toMatchObject({
      sessions: { count: 4, hasMore: false },
      operations: { count: 4, hasMore: false },
    })
    expect(f.repo.getRuntimeSession('new-old-session')).toBeDefined()
    expect(f.db.sqlite.prepare('SELECT count(*) AS n FROM app_settings').get()?.n).toBe(1)
  })

  it('rechecks protected state and complete row digests, skipping missing/changed records atomically', () => {
    const f = fixture()
    f.environment('becomes-active')
    for (const id of ['changed', 'missing', 'delete']) {
      f.session(id)
      f.operation(id)
    }
    f.session('protected', 'becomes-active')
    f.operation('protected', 'becomes-active')
    const { preview, candidates } = f.preview()
    f.repo.updateStatus('becomes-active', 'needs-recovery')
    f.db.sqlite.exec(
      "UPDATE runtime_sessions SET exit_reason = 'CHANGED' WHERE session_id = 'changed'; UPDATE operations SET kind = 'stop' WHERE operation_id = 'changed'; DELETE FROM runtime_sessions WHERE session_id = 'missing'; DELETE FROM operations WHERE operation_id = 'missing'",
    )
    const result = f.repo.commitHistoryCleanup(preview, candidates, now)
    expect(result.receipt.sessions).toEqual({ selected: 4, deleted: 1, skipped: 3 })
    expect(result.receipt.operations).toEqual({ selected: 4, deleted: 1, skipped: 3 })
    expect(f.repo.getRuntimeSession('protected')).toBeDefined()
  })
  it('protects a different compatibility anchor selected after preview rather than deleting it', () => {
    const f = fixture()
    f.session('a', 'env', '147')
    f.session('z', 'env', '148')
    const { preview, candidates } = f.preview()
    f.repo.deleteRuntimeSession('z')
    const result = f.repo.commitHistoryCleanup(preview, candidates, now)
    expect(result.receipt.sessions).toEqual({ selected: 1, deleted: 0, skipped: 1 })
    expect(f.repo.latestExecutableVersion('env')).toBe('147')
  })

  it.each(['operation-delete', 'receipt-insert', 'receipt-update'])(
    'rolls back both histories and the previous receipt on %s failure',
    (failure) => {
      const f = fixture()
      if (failure === 'receipt-update') {
        f.operation('first')
        const initial = f.preview()
        f.repo.commitHistoryCleanup(initial.preview, initial.candidates, now)
      }
      const before = f.repo.getHistoryCleanupReceipt()
      f.session('s')
      f.operation('o')
      const { preview, candidates } = f.preview()
      const trigger =
        failure === 'operation-delete'
          ? 'BEFORE DELETE ON operations'
          : failure === 'receipt-insert'
            ? 'BEFORE INSERT ON app_settings'
            : 'BEFORE UPDATE ON app_settings'
      f.db.sqlite.exec(
        `CREATE TRIGGER cleanup_fault ${trigger} BEGIN SELECT RAISE(ABORT, 'fixture fault'); END`,
      )
      expect(() => f.repo.commitHistoryCleanup(preview, candidates, now)).toThrow('fixture fault')
      expect(f.repo.getRuntimeSession('s')).toBeDefined()
      expect(f.repo.listOperations().some((row) => row.operationId === 'o')).toBe(true)
      expect(f.repo.getHistoryCleanupReceipt()).toEqual(before)
      f.db.sqlite.exec('DROP TRIGGER cleanup_fault')
      expect(f.repo.commitHistoryCleanup(preview, candidates, now).receipt.sessions.deleted).toBe(1)
    },
  )

  it('persists exactly the latest receipt across database restart and reports deleted cursors as stale', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-history-cleanup-'))
    cleanup.push(() => rmSync(root, { recursive: true, force: true }))
    const file = join(root, 'db.sqlite')
    const f = fixture(file)
    f.session('a')
    f.session('b')
    f.operation('one')
    const page = f.repo.pageActivity({ limit: 1 })
    expect(page.nextCursor).not.toBeNull()
    const first = f.preview()
    const result = f.repo.commitHistoryCleanup(first.preview, first.candidates, now)
    expect(() => f.repo.pageActivity({ limit: 1, cursor: page.nextCursor })).toThrow(
      'HISTORY_CURSOR_STALE',
    )
    f.close()
    const reopened = fixture(file)
    expect(reopened.repo.getHistoryCleanupReceipt()).toEqual(result.receipt)
    expect(reopened.repo.commitHistoryCleanup(first.preview, first.candidates, now).replayed).toBe(
      true,
    )
    reopened.operation('two')
    const next = reopened.preview()
    reopened.repo.commitHistoryCleanup(next.preview, next.candidates, now)
    expect(reopened.repo.getHistoryCleanupReceipt()?.previewId).toBe(next.preview.previewId)
    expect(reopened.db.sqlite.prepare('SELECT count(*) AS n FROM app_settings').get()?.n).toBe(1)
  })
  it('fails closed on an invalid persisted receipt without deleting any history', () => {
    const f = fixture()
    f.session('s')
    f.operation('o')
    const p = f.preview()
    f.repo.setSetting('history-cleanup:last-committed', { invalid: true })
    expect(() => f.repo.commitHistoryCleanup(p.preview, p.candidates, now)).toThrow(
      'HISTORY_CLEANUP_RECEIPT_INVALID',
    )
    expect(f.repo.getRuntimeSession('s')).toBeDefined()
  })
})
