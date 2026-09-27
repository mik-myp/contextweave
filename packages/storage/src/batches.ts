import type { DatabaseSync } from 'node:sqlite'
import {
  assertWorkspaceContext,
  batchIdSchema,
  batchPreviewSchema,
  batchTaskSchema,
  batchItemStatusSchema,
  batchPageInputSchema,
  batchPageSchema,
  batchSummarySchema,
  isBatchActive,
  type BatchTask,
  type BatchPreview,
  type BatchReason,
} from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'
import { batchTables } from './batch-schema'

type Row = Record<string, unknown>
export class BatchRepository {
  readonly workspaceId: string
  constructor(private readonly sqlite: DatabaseSync) {
    this.workspaceId = new WorkspaceRepository(sqlite).current().workspaceId
  }
  private transaction<T>(action: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const value = action()
      this.sqlite.exec('COMMIT')
      return value
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
  private read(row: Row): BatchTask {
    assertWorkspaceContext(this, { workspaceId: row.workspace_id })
    const items = this.sqlite
      .prepare('SELECT * FROM batch_items WHERE task_id=? ORDER BY ordinal')
      .all(String(row.task_id))
      .map((item) => {
        assertWorkspaceContext(this, { workspaceId: item.workspace_id })
        return {
          environmentId: item.environment_id,
          name: item.name,
          revision: item.revision,
          ordinal: item.ordinal,
          status: item.status,
          reason: item.reason,
          startedAt: item.started_at,
          endedAt: item.ended_at,
        }
      })
    const counts = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      unknown: 0,
    }
    for (const item of items) {
      counts[batchItemStatusSchema.parse(item.status)]++
    }
    return batchTaskSchema.parse({
      id: row.task_id,
      workspaceId: row.workspace_id,
      action: row.action,
      status: row.status,
      sourceTaskId: row.source_task_id,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      total: row.total,
      counts,
      items,
    })
  }
  get(input: unknown): BatchTask | undefined {
    const row = this.sqlite
      .prepare('SELECT * FROM batch_tasks WHERE task_id=?')
      .get(batchIdSchema.parse(input))
    return row ? this.read(row) : undefined
  }
  page(input: unknown) {
    const { beforeId, limit } = batchPageInputSchema.parse(input)
    const anchor = beforeId ? this.get(beforeId) : undefined
    if (beforeId && !anchor) throw new Error('BATCH_CURSOR_STALE')
    const rows = anchor
      ? this.sqlite
          .prepare(
            'SELECT * FROM batch_tasks WHERE (created_at,task_id)<(?,?) ORDER BY created_at DESC,task_id DESC LIMIT ?',
          )
          .all(anchor.createdAt, anchor.id, limit + 1)
      : this.sqlite
          .prepare('SELECT * FROM batch_tasks ORDER BY created_at DESC,task_id DESC LIMIT ?')
          .all(limit + 1)
    const items = rows.slice(0, limit).map((row) => {
      const { items: _items, ...summary } = this.read(row)
      return batchSummarySchema.parse(summary)
    })
    return batchPageSchema.parse({
      workspaceId: this.workspaceId,
      items,
      nextCursor: rows.length > limit ? items.at(-1)!.id : null,
    })
  }
  create(input: BatchPreview, now = new Date().toISOString()): BatchTask {
    const preview = batchPreviewSchema.parse(input)
    assertWorkspaceContext(this, { workspaceId: preview.workspaceId })
    return this.transaction(() => {
      const existing = this.get(preview.id)
      if (existing) return existing
      if (preview.sourceTaskId && !this.get(preview.sourceTaskId)) throw new Error('NOT_FOUND')
      const queued = preview.targets.some((item) => item.reason === null)
      this.sqlite
        .prepare(
          'INSERT INTO batch_tasks(task_id,workspace_id,action,status,source_task_id,total,created_at,ended_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          preview.id,
          this.workspaceId,
          preview.action,
          queued ? 'queued' : 'completed',
          preview.sourceTaskId,
          preview.targets.length,
          now,
          queued ? null : now,
        )
      const insert = this.sqlite.prepare(
        'INSERT INTO batch_items(task_id,workspace_id,ordinal,environment_id,name,revision,status,reason,started_at,ended_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      preview.targets.forEach((target, index) =>
        insert.run(
          preview.id,
          this.workspaceId,
          index,
          target.environmentId,
          target.name,
          target.revision,
          target.reason ? 'skipped' : 'queued',
          target.reason,
          null,
          target.reason ? now : null,
        ),
      )
      return this.get(preview.id)!
    })
  }
  nextQueued(): BatchTask | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM batch_tasks WHERE status IN ('queued','running','cancelling') ORDER BY rowid LIMIT 1",
      )
      .get()
    return row ? this.read(row) : undefined
  }
  startItem(id: string, ordinal: number, now = new Date().toISOString()) {
    return this.transaction(() => {
      const task = this.get(id)
      if (
        !task ||
        !['queued', 'running'].includes(task.status) ||
        task.items[ordinal]?.status !== 'queued'
      )
        throw new Error('BATCH_STATE_CONFLICT')
      this.sqlite.prepare("UPDATE batch_tasks SET status='running' WHERE task_id=?").run(id)
      this.sqlite
        .prepare(
          "UPDATE batch_items SET status='running', started_at=? WHERE task_id=? AND ordinal=?",
        )
        .run(now, id, ordinal)
      return this.get(id)!
    })
  }
  finishItem(
    id: string,
    ordinal: number,
    status: 'succeeded' | 'failed' | 'skipped' | 'cancelled',
    reason: BatchReason | null,
    now = new Date().toISOString(),
  ) {
    return this.transaction(() => {
      const task = this.get(id),
        item = task?.items[ordinal]
      if (
        !task ||
        !isBatchActive(task.status) ||
        !item ||
        !['queued', 'running'].includes(item.status)
      )
        throw new Error('BATCH_STATE_CONFLICT')
      if (
        (status === 'succeeded' && reason !== null) ||
        (status !== 'succeeded' && reason === null)
      )
        throw new Error('BATCH_STATE_CONFLICT')
      this.sqlite
        .prepare(
          'UPDATE batch_items SET status=?, reason=?, ended_at=? WHERE task_id=? AND ordinal=?',
        )
        .run(status, reason, now, id, ordinal)
      this.finishIfSettled(id, now)
      return this.get(id)!
    })
  }
  private finishIfSettled(id: string, now: string) {
    // This runs inside the item transition transaction. Do not parse the
    // intermediate parent/child snapshot before its terminal status is updated.
    this.sqlite
      .prepare(
        `UPDATE batch_tasks SET
      status=CASE status WHEN 'cancelling' THEN 'cancelled' ELSE 'completed' END, ended_at=?
      WHERE task_id=? AND NOT EXISTS (
        SELECT 1 FROM batch_items WHERE task_id=? AND status IN ('queued','running')
      )`,
      )
      .run(now, id, id)
  }

  cancel(id: string, now = new Date().toISOString()) {
    return this.transaction(() => {
      const task = this.get(id)
      if (!task) throw new Error('NOT_FOUND')
      if (!isBatchActive(task.status)) return task
      this.sqlite.prepare("UPDATE batch_tasks SET status='cancelling' WHERE task_id=?").run(id)
      this.sqlite
        .prepare(
          "UPDATE batch_items SET status='cancelled', reason='CANCELLED', ended_at=? WHERE task_id=? AND status='queued'",
        )
        .run(now, id)
      this.finishIfSettled(id, now)
      return this.get(id)!
    })
  }
  cancelQueued(now = new Date().toISOString()) {
    const ids = this.sqlite
      .prepare("SELECT task_id FROM batch_tasks WHERE status IN ('queued','running','cancelling')")
      .all()
    for (const row of ids) this.cancel(String(row.task_id), now)
  }
  recoverInterrupted(now = new Date().toISOString()) {
    return this.transaction(() => {
      const ids = this.sqlite
        .prepare(
          "SELECT task_id FROM batch_tasks WHERE status IN ('queued','running','cancelling')",
        )
        .all()
      for (const row of ids) {
        const id = String(row.task_id)
        this.sqlite
          .prepare(
            "UPDATE batch_items SET status=CASE status WHEN 'running' THEN 'unknown' ELSE 'skipped' END, reason='BATCH_INTERRUPTED', ended_at=? WHERE task_id=? AND status IN ('queued','running')",
          )
          .run(now, id)
        this.sqlite
          .prepare("UPDATE batch_tasks SET status='interrupted', ended_at=? WHERE task_id=?")
          .run(now, id)
      }
      return ids.length
    })
  }
}
export function verifyBatchStorage(sqlite: DatabaseSync) {
  try {
    const repository = new BatchRepository(sqlite)
    for (const table of batchTables) {
      const column = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .find((row) => row.name === 'workspace_id')
      if (column?.notnull !== 1 || column.dflt_value !== `'${repository.workspaceId}'`)
        throw new Error('INVALID_OWNER')
      if (
        sqlite
          .prepare(`SELECT 1 FROM ${table} WHERE workspace_id IS NULL OR workspace_id!=? LIMIT 1`)
          .get(repository.workspaceId)
      )
        throw new Error('INVALID_OWNER')
    }
    for (const row of sqlite.prepare('SELECT task_id FROM batch_tasks').all())
      repository.get(row.task_id)
  } catch {
    throw new Error('DATABASE_INTEGRITY_FAILED')
  }
}
