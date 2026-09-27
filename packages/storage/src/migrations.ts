import { migrateOrganization } from './organization-schema'
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrateIntegritySchema } from './integrity'
import { migrateLocalWorkspace } from './workspaces'
import { migrateWorkspaceScope } from './workspace-scope'

const initialSchema = `
CREATE TABLE IF NOT EXISTS environments (
  environment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  kernel_id TEXT NOT NULL,
  kernel_version TEXT NOT NULL,
  proxy_id TEXT,
  config_json TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kernel_installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kernel_id TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  source_url TEXT,
  sha256 TEXT,
  install_path TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_sessions (
  session_id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  control_port INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_reason TEXT
);
CREATE TABLE IF NOT EXISTS proxies (
  proxy_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  credential_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_environments_updated_at ON environments(updated_at);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_environment ON runtime_sessions(environment_id);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_status ON runtime_sessions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kernel_installations_identity
  ON kernel_installations(kernel_id, version, platform, arch);
`

export const databaseVersion = 11
export function migrateDatabase(sqlite: DatabaseSync, filePath: string): void {
  let version = Number(sqlite.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (version > databaseVersion)
    throw new Error('This database requires a newer ContextWeave version')
  if (version === databaseVersion) return
  const existing = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='environments'")
    .get()
  if (existing && filePath !== ':memory:') {
    const backupPath = `${filePath}.before-v${databaseVersion}-${Date.now()}-${randomUUID()}.bak`
    // VACUUM INTO takes a consistent SQLite snapshot, including committed WAL pages.
    sqlite.prepare('VACUUM INTO ?').run(backupPath)
  }
  // SQLite cannot change foreign_keys inside a transaction. Restore and verify it on
  // every exit, including failure to acquire the write lock; openLocalDatabase closes
  // a connection if rollback or restoration fails.
  let transactionOpen = false
  let failure: unknown
  try {
    sqlite.exec('PRAGMA foreign_keys = OFF')
    if (sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 0)
      throw new Error('DATABASE_FOREIGN_KEYS_UNAVAILABLE')
    sqlite.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    // Another process may have migrated while the pre-migration backup was captured.
    // Only the version read under our write transaction is authoritative for DDL.
    version = Number(sqlite.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version > databaseVersion)
      throw new Error('This database requires a newer ContextWeave version')
    if (version < 1) {
      sqlite.exec(initialSchema)
      sqlite.exec(`
      ALTER TABLE environments ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE environments ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE environments ADD COLUMN trashed_at TEXT;
      CREATE TABLE environment_revisions (
        environment_id TEXT NOT NULL, revision INTEGER NOT NULL, config_json TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (environment_id, revision)
      );
      INSERT INTO environment_revisions SELECT environment_id, 1, config_json, updated_at FROM environments;
      ALTER TABLE runtime_sessions ADD COLUMN ended_at TEXT;
      ALTER TABLE runtime_sessions ADD COLUMN revision INTEGER;
      ALTER TABLE runtime_sessions ADD COLUMN kernel_version TEXT;
      ALTER TABLE runtime_sessions ADD COLUMN executable_version TEXT;
      ALTER TABLE runtime_sessions ADD COLUMN phase TEXT NOT NULL DEFAULT 'legacy';
      CREATE TABLE operations (
        operation_id TEXT PRIMARY KEY, environment_id TEXT, kind TEXT NOT NULL,
        status TEXT NOT NULL, phase TEXT NOT NULL, started_at TEXT NOT NULL,
        ended_at TEXT, error_code TEXT
      );
      CREATE INDEX idx_operations_started ON operations(started_at DESC);
      PRAGMA user_version = 1;
    `)
    }
    if (version < 2)
      sqlite.exec(`
      ALTER TABLE proxies ADD COLUMN name TEXT NOT NULL DEFAULT '';
      UPDATE proxies SET name = host || ':' || port WHERE name = '';
      PRAGMA user_version = 2;
    `)
    if (version < 3)
      sqlite.exec(`
      CREATE TABLE credential_cleanup (
        credential_ref TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 3;
    `)
    if (version < 4)
      sqlite.exec(
        `ALTER TABLE runtime_sessions ADD COLUMN process_identity TEXT; PRAGMA user_version = 4;`,
      )
    if (version < 5) migrateIntegritySchema(sqlite)
    if (version < 6)
      sqlite.exec(`
      CREATE INDEX idx_sessions_timeline ON runtime_sessions(started_at DESC, session_id DESC);
      CREATE INDEX idx_operations_timeline ON operations(started_at DESC, operation_id DESC);
      CREATE INDEX idx_sessions_active ON runtime_sessions(environment_id, started_at DESC, session_id DESC)
        WHERE status IN ('starting', 'running', 'stopping');
      CREATE INDEX idx_sessions_executable ON runtime_sessions(environment_id, started_at DESC, session_id DESC)
        WHERE executable_version IS NOT NULL AND executable_version != '';
      PRAGMA user_version = 6;
    `)
    if (version < 7)
      sqlite.exec(`
      CREATE TABLE screenshot_artifacts (
        artifact_id TEXT PRIMARY KEY NOT NULL CHECK(length(artifact_id) = 36),
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 128 AND substr(task_id, 1, 1) GLOB '[a-zA-Z0-9]' AND task_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
        allocation_name TEXT NOT NULL UNIQUE CHECK(length(allocation_name) = 10 AND substr(allocation_name, 1, 4) = 'run-' AND substr(allocation_name, 5) NOT GLOB '*[^a-zA-Z0-9]*'),
        bytes INTEGER NOT NULL CHECK(bytes BETWEEN 8 AND 33554432),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
        completed_at TEXT NOT NULL CHECK(length(completed_at) = 24 AND completed_at GLOB '????-??-??T??:??:??.???Z'),
        ownership_json TEXT NOT NULL CHECK(length(ownership_json) <= 1024) CHECK(CASE WHEN json_valid(ownership_json) THEN json_type(ownership_json) = 'object' ELSE 0 END)
      ) STRICT;
      CREATE INDEX idx_artifacts_timeline ON screenshot_artifacts(completed_at DESC, artifact_id DESC);
      CREATE INDEX idx_artifacts_environment ON screenshot_artifacts(environment_id);
      PRAGMA user_version = 7;
    `)
    if (version < 8)
      sqlite.exec(`
      CREATE TABLE screenshot_budget (
        id INTEGER PRIMARY KEY CHECK(id=1),
        limit_mib INTEGER NOT NULL CHECK(limit_mib BETWEEN 32 AND 102400),
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
      ) STRICT;
      INSERT INTO screenshot_budget VALUES (1,1024,1);
      CREATE TABLE screenshot_reservations (
        artifact_id TEXT PRIMARY KEY NOT NULL CHECK(length(artifact_id)=36),
        environment_id TEXT NOT NULL REFERENCES environments(environment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 128 AND substr(task_id,1,1) GLOB '[a-zA-Z0-9]' AND task_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
        reserved_at TEXT NOT NULL CHECK(length(reserved_at)=24 AND reserved_at GLOB '????-??-??T??:??:??.???Z'),
        allocation_name TEXT UNIQUE CHECK(allocation_name IS NULL OR (length(allocation_name)=10 AND substr(allocation_name,1,4)='run-' AND substr(allocation_name,5) NOT GLOB '*[^a-zA-Z0-9]*')),
        ownership_json TEXT CHECK(ownership_json IS NULL OR (length(ownership_json)<=1024 AND CASE WHEN json_valid(ownership_json) THEN json_type(ownership_json)='object' ELSE 0 END)),
        CHECK((allocation_name IS NULL AND ownership_json IS NULL) OR (allocation_name IS NOT NULL AND ownership_json IS NOT NULL))
      ) STRICT;
      CREATE INDEX idx_screenshot_reservations_environment ON screenshot_reservations(environment_id);
      PRAGMA user_version=8;
    `)
    if (version < 9) {
      migrateLocalWorkspace(sqlite)
      sqlite.exec('PRAGMA user_version = 9')
    }
    if (version < 10) {
      migrateWorkspaceScope(sqlite)
      sqlite.exec('PRAGMA user_version = 10')
    }
    if (version < 11) {
      migrateOrganization(sqlite)
      sqlite.exec('PRAGMA user_version = 11')
    }
    sqlite.exec('COMMIT')
    transactionOpen = false
  } catch (error) {
    failure = error
    if (transactionOpen) {
      try {
        sqlite.exec('ROLLBACK')
        transactionOpen = false
      } catch (rollbackError) {
        failure = new AggregateError([error, rollbackError], 'MIGRATION_ROLLBACK_FAILED')
      }
    }
  }
  try {
    sqlite.exec('PRAGMA foreign_keys = ON')
    if (sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1)
      throw new Error('DATABASE_FOREIGN_KEYS_UNAVAILABLE')
  } catch (restoreError) {
    failure =
      failure === undefined
        ? restoreError
        : new AggregateError(
            [failure, restoreError],
            transactionOpen ? 'MIGRATION_ROLLBACK_FAILED' : 'MIGRATION_RECOVERY_FAILED',
          )
  }
  if (failure !== undefined) throw failure
}
