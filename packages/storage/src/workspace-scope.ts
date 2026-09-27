import type { DatabaseSync } from 'node:sqlite'
import { WorkspaceRepository } from './workspaces'

// A database continues to have exactly one owner. Fixed CHECKs also reject a forged
// owner when a caller turns FK enforcement off; no environment display names are used.
export const workspaceTables = [
  'environments',
  'environment_revisions',
  'proxies',
  'runtime_sessions',
  'operations',
  'credential_cleanup',
  'kernel_installations',
  'app_settings',
  'screenshot_artifacts',
  'screenshot_budget',
  'screenshot_reservations',
] as const

/** Called only in the migration transaction, after the v9 identity has been validated. */
export function migrateWorkspaceScope(sqlite: DatabaseSync): void {
  const { workspaceId } = new WorkspaceRepository(sqlite).current()
  for (const table of workspaceTables) {
    // Table names are a fixed allowlist; workspaceId is a validated canonical UUID.
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT NOT NULL
      DEFAULT '${workspaceId}' CHECK(workspace_id = '${workspaceId}')
      REFERENCES local_workspace(workspace_id) ON DELETE RESTRICT ON UPDATE RESTRICT`)
  }
  verifyWorkspaceScope(sqlite)
}

export function verifyWorkspaceScope(sqlite: DatabaseSync): void {
  const { workspaceId } = new WorkspaceRepository(sqlite).current()
  for (const table of workspaceTables) {
    const column = sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .find((item) => item.name === 'workspace_id')
    if (!column || column.notnull !== 1 || column.dflt_value !== `'${workspaceId}'`)
      throw new Error('DATABASE_WORKSPACE_INVALID')
    if (
      sqlite
        .prepare(`SELECT 1 FROM ${table} WHERE workspace_id IS NULL OR workspace_id != ? LIMIT 1`)
        .get(workspaceId)
    )
      throw new Error('DATABASE_WORKSPACE_INVALID')
  }
}
