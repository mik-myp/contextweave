import type { DatabaseSync } from 'node:sqlite'
import { WorkspaceRepository } from './workspaces'

export const organizationTables = [
  'environment_groups',
  'environment_organization',
  'environment_views',
] as const

/** Only called within the versioned migration transaction; existing user files stay in place. */
export function migrateOrganization(sqlite: DatabaseSync) {
  const { workspaceId } = new WorkspaceRepository(sqlite).current()
  const owner = `workspace_id TEXT NOT NULL DEFAULT '${workspaceId}'
    CHECK(workspace_id = '${workspaceId}') REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT`
  sqlite.exec(`
    CREATE TABLE environment_groups (
      group_id TEXT PRIMARY KEY NOT NULL,
      ${owner}, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE environment_organization (
      environment_id TEXT PRIMARY KEY NOT NULL REFERENCES environments(environment_id) ON DELETE CASCADE ON UPDATE RESTRICT,
      ${owner}, group_id TEXT REFERENCES environment_groups(group_id) ON DELETE SET NULL ON UPDATE RESTRICT,
      tags_json TEXT NOT NULL CHECK(CASE WHEN json_valid(tags_json) THEN json_type(tags_json)='array' AND json_array_length(tags_json)<=20 ELSE 0 END),
      note TEXT NOT NULL CHECK(length(note)<=4000),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
    ) STRICT;
    CREATE INDEX idx_environment_organization_group ON environment_organization(group_id);
    CREATE TABLE environment_views (
      view_id TEXT PRIMARY KEY NOT NULL,
      ${owner}, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      name_key TEXT NOT NULL UNIQUE CHECK(length(name_key)>0),
      view_json TEXT NOT NULL CHECK(CASE WHEN json_valid(view_json) THEN json_type(view_json)='object' ELSE 0 END),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), updated_at TEXT NOT NULL
    ) STRICT;
  `)
}
