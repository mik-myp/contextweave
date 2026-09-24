import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

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

export const databaseVersion = 3
export function migrateDatabase(sqlite: DatabaseSync, filePath: string): void {
  const version = Number(sqlite.prepare('PRAGMA user_version').get()?.user_version ?? 0)
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
  sqlite.exec('BEGIN IMMEDIATE')
  try {
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
    sqlite.exec('COMMIT')
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'MIGRATION_ROLLBACK_FAILED')
    }
    throw error
  }
}
