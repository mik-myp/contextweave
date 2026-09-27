// A genuine published v4 schema, not a new schema with its version lowered.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export function openVersion4Fixture(filePath: string) {
  const sqlite = new DatabaseSync(filePath)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  try {
    sqlite.exec('BEGIN IMMEDIATE')
    sqlite.exec(readFileSync(new URL('../test-fixtures/schema-v4.sql', import.meta.url), 'utf8'))
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.close()
    throw error
  }
  return { sqlite, close: () => sqlite.close() }
}
