import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { environmentViewSchema, organizationNameKey, tagsSchema } from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'

/** v14 only. The migration executor owns backup, transaction, validation and version writes. */
export function migrateTags(sqlite: DatabaseSync) {
  const { workspaceId } = new WorkspaceRepository(sqlite).current()
  sqlite.exec(`
    CREATE TABLE environment_tags (
      tag_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '${workspaceId}'
        CHECK(workspace_id = '${workspaceId}') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
      name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      updated_at TEXT NOT NULL
    ) STRICT;
  `)
  const names = new Map<string, string>()
  // Deterministic first display spelling; leave all original association bytes/revisions intact.
  // Invalid legacy data aborts the entire migration, never gets skipped or replaced by [].
  try {
    for (const row of sqlite
      .prepare('SELECT tags_json FROM environment_organization ORDER BY environment_id')
      .all())
      for (const name of tagsSchema.parse(JSON.parse(String(row.tags_json))))
        if (!names.has(organizationNameKey(name))) names.set(organizationNameKey(name), name)
    for (const row of sqlite
      .prepare('SELECT view_json FROM environment_views ORDER BY view_id')
      .all())
      for (const key of environmentViewSchema.parse(JSON.parse(String(row.view_json))).filters.tags)
        if (!names.has(key)) names.set(key, key)
  } catch {
    throw new Error('DATABASE_INTEGRITY_FAILED')
  }
  const insert = sqlite.prepare(
    'INSERT INTO environment_tags(tag_id, workspace_id, name, name_key, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)',
  )
  const updatedAt = new Date().toISOString()
  for (const [key, name] of names) insert.run(randomUUID(), workspaceId, name, key, updatedAt)
}
