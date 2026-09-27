import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrationCatalog } from './migration-catalog'
import { readDatabaseMigrationPlan } from './storage-compatibility'
import { verifyLocalDatabase } from './database-validation'

export { databaseVersion } from './storage-compatibility'

export function migrateDatabase(sqlite: DatabaseSync, filePath: string): void {
  const initial = readDatabaseMigrationPlan(sqlite)
  if (initial.state === 'current') return
  const existing = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='environments'")
    .get()
  if (existing && filePath !== ':memory:') {
    const backupPath = `${filePath}.before-v${initial.toVersion}-${Date.now()}-${randomUUID()}.bak`
    // VACUUM INTO includes committed WAL pages, never another connection's uncommitted writes.
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
    const plan = readDatabaseMigrationPlan(sqlite)
    for (const step of migrationCatalog.slice(plan.fromVersion)) {
      step.apply(sqlite)
      sqlite.exec(`PRAGMA user_version = ${step.version}`)
      if (readDatabaseMigrationPlan(sqlite).fromVersion !== step.version)
        throw new Error('DATABASE_VERSION_WRITE_FAILED')
    }
    // Validate all final facts before committing DDL/data/version. A startup refusal
    // must not leave an invalid old workspace silently upgraded and non-rollbackable.
    verifyLocalDatabase(sqlite)
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
