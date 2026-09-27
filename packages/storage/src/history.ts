import { createHash } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  activityHistoryQuerySchema,
  activityHistoryPageSchema,
  operationHistoryQuerySchema,
  operationHistoryPageSchema,
  type HistoryQuery,
} from '@contextweave/contracts'

export function initializeHistoryQueries(sqlite: DatabaseSync) {
  // SQLite's built-in lower() is ASCII-only; preserve Unicode case-insensitive UI search.
  sqlite.function('cw_fold', { deterministic: true }, (value) => String(value ?? '').toLowerCase())
}
function scalar(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new Error('HISTORY_VALUE_INVALID')
}

// Only these static expressions can enter SQL. All user values use bound parameters.
const activitySort = {
  environment: "coalesce(e.name, '') || ' ' || h.environment_id || ' ' || h.session_id",
  status: 'h.status',
  startedAt: 'h.started_at',
  endedAt: "coalesce(h.ended_at, '')",
  revision: 'coalesce(h.revision, -1)',
  executableVersion: "coalesce(h.executable_version, '')",
  sessionId: 'h.session_id',
  exitReason: "coalesce(h.exit_reason, '')",
} as const
const operationSort = {
  kind: 'h.kind',
  environmentId: "coalesce(e.name, '') || ' ' || coalesce(h.environment_id, '')",
  status: 'h.status',
  phase: 'h.phase',
  startedAt: 'h.started_at',
  endedAt: "coalesce(h.ended_at, '')",
  errorCode: "coalesce(h.error_code, '')",
} as const
const activitySearch = [
  activitySort.environment,
  'h.ended_at',
  'h.revision',
  'h.executable_version',
]
const operationSearch = Object.values(operationSort)

function queryDigest(domain: string, query: HistoryQuery) {
  return createHash('sha256')
    .update(JSON.stringify({ ...query, cursor: null, domain }))
    .digest('hex')
}
type Cursor = { version: 1; query: string; id: string; side: 'next' | 'previous' }
function decodeCursor(encoded: string, digest: string): Cursor {
  try {
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw new Error()
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const cursor = value as Record<string, unknown>
    if (
      Object.keys(cursor).sort().join(',') !== 'id,query,side,version' ||
      cursor.version !== 1 ||
      cursor.query !== digest ||
      typeof cursor.id !== 'string' ||
      !cursor.id ||
      cursor.id.length > 512 ||
      (cursor.side !== 'next' && cursor.side !== 'previous')
    )
      throw new Error()
    return { version: 1, query: digest, id: cursor.id, side: cursor.side }
  } catch {
    throw new Error('HISTORY_CURSOR_INVALID')
  }
}
function encodeCursor(digest: string, id: unknown, side: Cursor['side']): string {
  if (typeof id !== 'string' || !id || id.length > 512) throw new Error('HISTORY_CURSOR_INVALID')
  return Buffer.from(JSON.stringify({ version: 1, query: digest, id, side })).toString('base64url')
}

function readPage(
  sqlite: DatabaseSync,
  domain: 'activity' | 'operations',
  query: HistoryQuery,
  sort: string,
  searchFields: readonly string[],
) {
  const table = domain === 'activity' ? 'runtime_sessions' : 'operations'
  const id = domain === 'activity' ? 'session_id' : 'operation_id'
  const from = `FROM ${table} h LEFT JOIN environments e ON e.environment_id = h.environment_id`
  const conditions: string[] = []
  const values: SQLInputValue[] = []
  if (query.statuses.length) {
    conditions.push(`h.status IN (${query.statuses.map(() => '?').join(',')})`)
    values.push(...query.statuses)
  }
  if (query.search) {
    // Literal substring, not LIKE wildcards. Locale-sensitive translated labels are display-only.
    conditions.push(
      `(${searchFields.map((field) => `instr(cw_fold(${field}), cw_fold(?)) > 0`).join(' OR ')})`,
    )
    values.push(...searchFields.map(() => query.search))
  }
  const where = (boundary?: string) =>
    [...conditions, ...(boundary ? [boundary] : [])].join(' AND ') || '1'
  const digest = queryDigest(domain, query)
  const cursor = query.cursor ? decodeCursor(query.cursor, digest) : null
  const descending = query.direction === 'desc'
  const comparison = (side: Cursor['side']) => ((side === 'next') === descending ? '<' : '>')
  const boundary = (side: Cursor['side']) => `(${sort}, h.${id}) ${comparison(side)} (?, ?)`
  const direction = (cursor?.side === 'previous' ? !descending : descending) ? 'DESC' : 'ASC'
  // A SAVEPOINT works both standalone and inside an existing repository transaction.
  sqlite.exec('SAVEPOINT history_page')
  try {
    let anchorValues: SQLInputValue[] = []
    if (cursor) {
      const anchor = sqlite
        .prepare(`SELECT ${sort} AS sort_value ${from} WHERE h.${id} = ?`)
        .get(cursor.id)
      if (!anchor) throw new Error('HISTORY_CURSOR_STALE')
      anchorValues = [scalar(anchor.sort_value), cursor.id]
    }
    const rows = sqlite
      .prepare(
        `SELECT h.*, e.name AS environment_name, ${sort} AS sort_value
      ${from} WHERE ${where(cursor ? boundary(cursor.side) : undefined)}
      ORDER BY ${sort} ${direction}, h.${id} ${direction} LIMIT ?`,
      )
      .all(...values, ...anchorValues, query.limit)
    if (cursor?.side === 'previous') rows.reverse()
    const exists = (row: Record<string, unknown> | undefined, side: Cursor['side']) =>
      row &&
      Boolean(
        sqlite
          .prepare(`SELECT 1 ${from} WHERE ${where(boundary(side))} LIMIT 1`)
          .get(...values, scalar(row.sort_value), scalar(row[id])),
      )
    const first = rows[0]
    const last = rows.at(-1)
    const result = {
      rows,
      previousCursor: exists(first, 'previous')
        ? encodeCursor(digest, first?.[id], 'previous')
        : null,
      nextCursor: exists(last, 'next') ? encodeCursor(digest, last?.[id], 'next') : null,
    }
    sqlite.exec('RELEASE history_page')
    return result
  } catch (error) {
    sqlite.exec('ROLLBACK TO history_page; RELEASE history_page')
    throw error
  }
}

export function readActivityPage(sqlite: DatabaseSync, input: unknown) {
  const query = activityHistoryQuerySchema.parse(input)
  const page = readPage(sqlite, 'activity', query, activitySort[query.sortBy], activitySearch)
  return activityHistoryPageSchema.parse({
    previousCursor: page.previousCursor,
    nextCursor: page.nextCursor,
    items: page.rows.map((row) => ({
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      environmentId: row.environment_id,
      environmentName: row.environment_name ?? undefined,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      revision: row.revision ?? undefined,
      kernelVersion: row.kernel_version ?? undefined,
      executableVersion: row.executable_version ?? undefined,
      phase: row.phase,
      exitReason: row.exit_reason,
    })),
  })
}
export function readOperationPage(sqlite: DatabaseSync, input: unknown) {
  const query = operationHistoryQuerySchema.parse(input)
  const page = readPage(sqlite, 'operations', query, operationSort[query.sortBy], operationSearch)
  return operationHistoryPageSchema.parse({
    previousCursor: page.previousCursor,
    nextCursor: page.nextCursor,
    items: page.rows.map((row) => ({
      workspaceId: row.workspace_id,
      operationId: row.operation_id,
      environmentId: row.environment_id,
      environmentName: row.environment_name ?? undefined,
      kind: row.kind,
      status: row.status,
      phase: row.phase,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      errorCode: row.error_code,
    })),
  })
}
