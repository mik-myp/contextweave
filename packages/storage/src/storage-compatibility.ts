import type { DatabaseSync } from 'node:sqlite'
import { migrationCatalog } from './migration-catalog'

/** Physical SQLite schema, independent of the application SemVer and external formats. */
export const databaseVersion = 14
export type DatabaseMigrationPlan = Readonly<{
  fromVersion: number
  toVersion: number
  state: 'initialize' | 'upgrade' | 'current'
  steps: readonly Readonly<{ version: number; id: string }>[]
}>

/** Pure description: never opens a database, snapshots files, or applies a migration. */
export function describeDatabaseMigration(version: number): DatabaseMigrationPlan {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('DATABASE_VERSION_INVALID')
  if (version > databaseVersion)
    throw new Error('This database requires a newer ContextWeave version')
  if (
    migrationCatalog.length !== databaseVersion ||
    migrationCatalog.some((step, index) => step.version !== index + 1) ||
    new Set(migrationCatalog.map((step) => step.id)).size !== databaseVersion
  )
    throw new Error('DATABASE_MIGRATION_CATALOG_INVALID')
  return Object.freeze({
    fromVersion: version,
    toVersion: databaseVersion,
    state: version === databaseVersion ? 'current' : version === 0 ? 'initialize' : 'upgrade',
    steps: Object.freeze(
      migrationCatalog.slice(version).map(({ version, id }) => Object.freeze({ version, id })),
    ),
  })
}

/** Reads SQLite's actual version, including when opened read-only; never trusts a supplied filename. */
export function readDatabaseMigrationPlan(sqlite: DatabaseSync): DatabaseMigrationPlan {
  const version = sqlite.prepare('PRAGMA user_version').get()?.user_version
  if (typeof version !== 'number') throw new Error('DATABASE_VERSION_INVALID')
  return describeDatabaseMigration(version)
}
