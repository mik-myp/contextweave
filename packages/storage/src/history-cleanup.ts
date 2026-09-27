import { createHash } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { historyCleanupBatchLimit } from '@contextweave/contracts'

type Candidate = Readonly<{ id: string; digest: string }>
export type HistoryCleanupCandidates = Readonly<{
  cutoffAt: string
  sessions: readonly Candidate[]
  operations: readonly Candidate[]
  moreSessions: boolean
  moreOperations: boolean
}>
type Domain = 'sessions' | 'operations'

export function initializeHistoryCleanup(sqlite: DatabaseSync) {
  // Unknown, noncanonical and calendar-invalid dates are preserved, not normalized into age.
  sqlite.function('cw_history_time', { deterministic: true }, (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
      return null
    const time = Date.parse(value)
    return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null
  })
}
const tables = {
  sessions: ['runtime_sessions', 'session_id'],
  operations: ['operations', 'operation_id'],
} as const
function eligibility(domain: Domain) {
  const terminal =
    domain === 'sessions'
      ? `h.status IN ('stopped', 'crashed') AND h.phase = 'ended'
       AND (h.exit_reason IS NULL OR h.exit_reason != 'CLIENT_INTERRUPTED')
       AND h.session_id != COALESCE((SELECT v.session_id FROM runtime_sessions v
         WHERE v.environment_id = h.environment_id AND v.executable_version IS NOT NULL
         AND v.executable_version != '' ORDER BY v.started_at DESC, v.session_id DESC LIMIT 1), '')`
      : `((h.status = 'succeeded' AND h.phase = 'completed' AND h.error_code IS NULL)
       OR (h.status IN ('failed', 'cancelled') AND h.phase IN ('completed', 'failed')
         AND h.error_code IS NOT NULL AND trim(h.error_code) != '' AND h.error_code != 'CLIENT_INTERRUPTED'))`
  return `${terminal}
    AND cw_history_time(h.started_at) IS NOT NULL AND cw_history_time(h.ended_at) IS NOT NULL
    AND h.started_at <= h.ended_at AND h.ended_at < ?
    AND NOT EXISTS (SELECT 1 FROM environments e WHERE e.environment_id = h.environment_id
      AND e.status IN ('starting', 'running', 'stopping', 'needs-recovery'))
    AND NOT EXISTS (SELECT 1 FROM runtime_sessions a WHERE a.environment_id = h.environment_id
      AND a.status IN ('starting', 'running', 'stopping'))
    AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.environment_id = h.environment_id AND o.status = 'running')`
}
function digest(row: Record<string, SQLOutputValue>) {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex')
}
export function readHistoryCleanupCandidates(
  sqlite: DatabaseSync,
  cutoffAt: string,
): HistoryCleanupCandidates {
  const read = (domain: Domain) => {
    const [table, id] = tables[domain]
    // LIMIT bounds the candidate batch, not the amount of work needed to scan/filter a database.
    const rows = sqlite
      .prepare(
        `SELECT h.* FROM ${table} h WHERE ${eligibility(domain)}
      ORDER BY h.started_at ASC, h.${id} ASC LIMIT ?`,
      )
      .all(cutoffAt, historyCleanupBatchLimit + 1)
    return {
      items: rows
        .slice(0, historyCleanupBatchLimit)
        .map((row) => ({ id: String(row[id]), digest: digest(row) })),
      hasMore: rows.length > historyCleanupBatchLimit,
    }
  }
  const sessions = read('sessions')
  const operations = read('operations')
  return {
    cutoffAt,
    sessions: sessions.items,
    operations: operations.items,
    moreSessions: sessions.hasMore,
    moreOperations: operations.hasMore,
  }
}
/** Caller holds the repository write transaction for recheck, both deletions and the receipt. */
export function deleteHistoryCleanupCandidates(
  sqlite: DatabaseSync,
  candidates: HistoryCleanupCandidates,
) {
  const remove = (domain: Domain) => {
    const [table, id] = tables[domain]
    const selected = candidates[domain]
    if (
      selected.length > historyCleanupBatchLimit ||
      new Set(selected.map((item) => item.id)).size !== selected.length
    )
      throw new Error('HISTORY_CLEANUP_PREVIEW_INVALID')
    const recheck = sqlite.prepare(
      `SELECT h.* FROM ${table} h WHERE h.${id} = ? AND ${eligibility(domain)}`,
    )
    const deletion = sqlite.prepare(`DELETE FROM ${table} WHERE ${id} = ?`)
    let deleted = 0
    for (const candidate of selected) {
      const row = recheck.get(candidate.id, candidates.cutoffAt)
      if (row && digest(row) === candidate.digest)
        deleted += Number(deletion.run(candidate.id).changes)
    }
    return { selected: selected.length, deleted, skipped: selected.length - deleted }
  }
  return { sessions: remove('sessions'), operations: remove('operations') }
}
