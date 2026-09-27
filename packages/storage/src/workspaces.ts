import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { localWorkspaceSchema, type LocalWorkspace } from '@contextweave/contracts'

/** One authoritative local database has one immutable owner; this is not multi-space access control. */
export class WorkspaceRepository {
  constructor(private readonly sqlite: DatabaseSync) {}

  current(): LocalWorkspace {
    const table = this.sqlite
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'local_workspace'")
      .get()
    if (!table) throw new Error('DATABASE_WORKSPACE_INVALID')
    const rows = this.sqlite.prepare('SELECT * FROM local_workspace LIMIT 2').all()
    const row = rows[0]
    if (rows.length !== 1 || row?.singleton !== 1) throw new Error('DATABASE_WORKSPACE_INVALID')
    const parsed = localWorkspaceSchema.safeParse({
      workspaceId: row.workspace_id,
      kind: row.kind,
      storageMode: row.storage_mode,
      createdAt: row.created_at,
    })
    // Never regenerate an identity for a database whose ownership is missing or invalid.
    if (!parsed.success) throw new Error('DATABASE_WORKSPACE_INVALID')
    return parsed.data
  }
}

/** Called only inside the encompassing migration write transaction. No user files are moved. */
export function migrateLocalWorkspace(sqlite: DatabaseSync): void {
  sqlite.exec(`
    CREATE TABLE local_workspace (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      workspace_id TEXT NOT NULL UNIQUE CHECK(
        length(workspace_id) = 36 AND workspace_id GLOB '????????-????-????-????-????????????'
        AND length(replace(workspace_id, '-', '')) = 32
        AND replace(workspace_id, '-', '') NOT GLOB '*[^0-9a-f]*'
      ),
      kind TEXT NOT NULL CHECK(kind = 'personal'),
      storage_mode TEXT NOT NULL CHECK(storage_mode = 'local'),
      created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z')
    ) STRICT;
  `)
  sqlite
    .prepare('INSERT INTO local_workspace VALUES (1, ?, ?, ?, ?)')
    .run(randomUUID(), 'personal', 'local', new Date().toISOString())
  sqlite.exec(`
    CREATE TRIGGER local_workspace_no_update BEFORE UPDATE ON local_workspace
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
    CREATE TRIGGER local_workspace_no_delete BEFORE DELETE ON local_workspace
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
    CREATE TRIGGER local_workspace_no_replace BEFORE INSERT ON local_workspace
      WHEN EXISTS (SELECT 1 FROM local_workspace)
      BEGIN SELECT RAISE(ABORT, 'DATABASE_WORKSPACE_IMMUTABLE'); END;
  `)
  new WorkspaceRepository(sqlite).current()
}

/** SQLite's actual main database, not a Renderer-provided filename. Empty only for :memory:. */
export function databaseFilePath(sqlite: DatabaseSync): string {
  const row = sqlite.prepare('PRAGMA database_list').all().find(row => row.name === 'main')
  if (typeof row?.file !== 'string') throw new Error('DATABASE_WORKSPACE_INVALID')
  return row.file
}
