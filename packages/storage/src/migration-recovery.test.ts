import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openLocalDatabase } from './index'
import { databaseVersion, migrateDatabase } from './migrations'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const action of cleanup.splice(0).reverse()) action()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-migration-recovery-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'data.sqlite')
  const db = openLocalDatabase(file)
  let closed = false
  const close = () => {
    if (!closed) {
      db.close()
      closed = true
    }
  }
  cleanup.push(close)
  db.sqlite.exec(`
    INSERT INTO app_settings VALUES ('fixture', '{"keep":true}', '2026-01-01T00:00:00Z');
    ALTER TABLE runtime_sessions DROP COLUMN process_identity;
    DROP TABLE credential_cleanup;
    PRAGMA user_version = 2;
  `)
  return { root, file, sqlite: db.sqlite, close }
}
function readVersion(sqlite: DatabaseSync) {
  return sqlite.prepare('PRAGMA user_version').get()?.user_version
}
function assertData(sqlite: DatabaseSync) {
  expect(
    sqlite.prepare("SELECT value_json FROM app_settings WHERE setting_key = 'fixture'").get()
      ?.value_json,
  ).toBe('{"keep":true}')
}

describe('migration failure and contention recovery', () => {
  it('retains a readable old backup and rolls back on close even when explicit rollback fails', () => {
    const f = fixture()
    const exec = f.sqlite.exec.bind(f.sqlite)
    const fault = vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT') throw new Error('injected commit failure')
      if (sql === 'ROLLBACK') throw new Error('injected rollback failure')
      return exec(sql)
    })
    let failure: unknown
    try {
      migrateDatabase(f.sqlite, f.file)
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({ message: 'MIGRATION_ROLLBACK_FAILED' })
    const backups = readdirSync(f.root).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(f.root, backups[0]!))
    try {
      expect(readVersion(backup)).toBe(2)
      assertData(backup)
    } finally {
      backup.close()
    }
    fault.mockRestore()
    f.close()
    const raw = new DatabaseSync(f.file)
    try {
      expect(readVersion(raw)).toBe(2)
      expect(
        raw.prepare("SELECT name FROM sqlite_master WHERE name = 'credential_cleanup'").get(),
      ).toBeUndefined()
      assertData(raw)
    } finally {
      raw.close()
    }
    const reopened = openLocalDatabase(f.file)
    try {
      expect(readVersion(reopened.sqlite)).toBe(databaseVersion)
      assertData(reopened.sqlite)
    } finally {
      reopened.close()
    }
  })

  it('fails safely while another writer owns the database and retries after the lock is released', () => {
    const f = fixture()
    const writer = new DatabaseSync(f.file)
    writer.exec('BEGIN IMMEDIATE')
    try {
      expect(() => migrateDatabase(f.sqlite, f.file)).toThrow()
      expect(readVersion(f.sqlite)).toBe(2)
      assertData(f.sqlite)
    } finally {
      writer.exec('ROLLBACK')
      writer.close()
    }
    migrateDatabase(f.sqlite, f.file)
    expect(readVersion(f.sqlite)).toBe(databaseVersion)
    assertData(f.sqlite)
  })

  it('rechecks schema version after acquiring the migration transaction', () => {
    const f = fixture()
    const exec = f.sqlite.exec.bind(f.sqlite)
    let competed = false
    vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'BEGIN IMMEDIATE' && !competed) {
        competed = true
        const second = new DatabaseSync(f.file)
        try {
          migrateDatabase(second, f.file)
        } finally {
          second.close()
        }
      }
      return exec(sql)
    })
    expect(() => migrateDatabase(f.sqlite, f.file)).not.toThrow()
    expect(readVersion(f.sqlite)).toBe(databaseVersion)
    assertData(f.sqlite)
  })

  it('never downgrades a newer schema that appeared before transaction ownership', () => {
    const f = fixture()
    const exec = f.sqlite.exec.bind(f.sqlite)
    vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'BEGIN IMMEDIATE') {
        const second = new DatabaseSync(f.file)
        try {
          second.exec('PRAGMA user_version = 99')
        } finally {
          second.close()
        }
      }
      return exec(sql)
    })
    expect(() => migrateDatabase(f.sqlite, f.file)).toThrow('newer ContextWeave')
    expect(readVersion(f.sqlite)).toBe(99)
    expect(
      f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'credential_cleanup'").get(),
    ).toBeUndefined()
    assertData(f.sqlite)
  })
})
