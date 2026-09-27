import type { DatabaseSync } from 'node:sqlite'
import {
  batchActionSchema,
  batchStatusSchema,
  batchItemStatusSchema,
  batchReasonSchema,
} from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'

export const batchTables = ['batch_items', 'batch_tasks'] as const
export function migrateBatches(sqlite: DatabaseSync) {
  const { workspaceId } = new WorkspaceRepository(sqlite).current()
  const owner = `workspace_id TEXT NOT NULL DEFAULT '${workspaceId}' CHECK(workspace_id = '${workspaceId}') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT`
  const values = (options: readonly string[]) => options.map((value) => `'${value}'`).join(',')
  sqlite.exec(`
    CREATE TABLE batch_tasks (
      task_id TEXT PRIMARY KEY NOT NULL,
      ${owner}, action TEXT NOT NULL CHECK(action IN (${values(batchActionSchema.options)})),
      status TEXT NOT NULL CHECK(status IN (${values(batchStatusSchema.options)})),
      source_task_id TEXT REFERENCES batch_tasks(task_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 100),
      created_at TEXT NOT NULL, ended_at TEXT
    ) STRICT;
    CREATE INDEX idx_batch_tasks_created ON batch_tasks(created_at DESC, task_id DESC);
    CREATE TABLE batch_items (
      task_id TEXT NOT NULL REFERENCES batch_tasks(task_id) ON DELETE CASCADE ON UPDATE RESTRICT,
      ${owner}, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
      environment_id TEXT NOT NULL CHECK(length(environment_id) BETWEEN 1 AND 512),
      name TEXT NOT NULL CHECK(length(name)<=200), revision INTEGER CHECK(revision BETWEEN 1 AND 9007199254740991),
      status TEXT NOT NULL CHECK(status IN (${values(batchItemStatusSchema.options)})),
      reason TEXT CHECK(reason IN (${values(batchReasonSchema.options)})),
      started_at TEXT, ended_at TEXT,
      PRIMARY KEY(task_id, ordinal), UNIQUE(task_id, environment_id)
    ) STRICT;
  `)
}
