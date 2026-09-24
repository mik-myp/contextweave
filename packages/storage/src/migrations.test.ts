import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from './index'
import { databaseVersion, migrateDatabase } from './migrations'

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-migration-v3-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'old.sqlite')
  const db = openLocalDatabase(file)
  cleanups.push(() => db.close())
  const repository = new EnvironmentRepository(db.sqlite)
  const proxy = repository.saveProxy('proxy', {
    name: 'Saved proxy',
    type: 'socks5',
    host: 'proxy.example.test',
    port: 1080,
    username: 'fixture',
    credentialRef: 'existing-secret',
  })
  const config = environmentConfigSchema.parse({
    environmentId: 'env',
    name: 'Existing',
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    proxyId: 'proxy',
    proxy,
    commonConfig: {},
  })
  repository.create({ config, dataDir: join(root, 'profile'), platform: 'darwin', arch: 'arm64' })
  repository.updateConfig({ ...config, name: 'Changed' }, 1)
  repository.deleteEnvironment('env')
  repository.setSetting('fixture', { keep: true })
  db.sqlite.exec('DROP TABLE credential_cleanup; PRAGMA user_version = 2;')
  const snapshot = () => ({
    proxies: repository.listProxies(),
    environments: repository.listAll(),
    revisions: db.sqlite.prepare('SELECT * FROM environment_revisions ORDER BY revision').all(),
    settings: db.sqlite.prepare('SELECT * FROM app_settings').all(),
  })
  return { root, file, db, repository, snapshot }
}
describe('schema v3 migration', () => {
  it('preserves v2 business data and takes a consistent backup including committed WAL pages', () => {
    const f = fixture()
    f.db.sqlite.exec('PRAGMA wal_autocheckpoint = 0')
    f.repository.setSetting('wal-committed', { value: 'only-in-wal' })
    const before = f.snapshot()
    migrateDatabase(f.db.sqlite, f.file)
    expect(f.snapshot()).toEqual(before)
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
    expect(f.repository.pendingCredentialCleanup()).toEqual([])
    migrateDatabase(f.db.sqlite, f.file)
    const backups = readdirSync(f.root).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(f.root, backups[0]!))
    try {
      expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
      expect(
        backup
          .prepare("SELECT value_json FROM app_settings WHERE setting_key = 'wal-committed'")
          .get()?.value_json,
      ).toBe('{"value":"only-in-wal"}')
      expect(backup.prepare('SELECT * FROM environment_revisions ORDER BY revision').all()).toEqual(
        before.revisions,
      )
      expect(
        backup.prepare("SELECT name FROM sqlite_master WHERE name = 'credential_cleanup'").get(),
      ).toBeUndefined()
    } finally {
      backup.close()
    }
  })
  it.each(['DDL', 'COMMIT'])(
    'rolls back schema/version on %s failure and retries without losing the old data',
    (phase) => {
      const f = fixture()
      const before = f.snapshot()
      const exec = f.db.sqlite.exec.bind(f.db.sqlite)
      const fault = vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
        if (phase === 'DDL' && sql.includes('CREATE TABLE credential_cleanup')) {
          exec(sql)
          throw new Error('injected schema failure')
        }
        if (phase === 'COMMIT' && sql === 'COMMIT') throw new Error('injected commit failure')
        return exec(sql)
      })
      expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('injected')
      expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
      expect(
        f.db.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE name = 'credential_cleanup'")
          .get(),
      ).toBeUndefined()
      expect(f.snapshot()).toEqual(before)
      fault.mockRestore()
      migrateDatabase(f.db.sqlite, f.file)
      expect(f.snapshot()).toEqual(before)
      expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(3)
    },
  )
  it('does not start migration or modify the database when its backup cannot be written', () => {
    const f = fixture()
    const before = f.snapshot()
    const prepare = f.db.sqlite.prepare.bind(f.db.sqlite)
    vi.spyOn(f.db.sqlite, 'prepare').mockImplementation((sql) => {
      if (sql === 'VACUUM INTO ?') throw new Error('backup disk full')
      return prepare(sql)
    })
    expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('backup disk full')
    expect(f.snapshot()).toEqual(before)
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
  })
  it('refuses future databases without making a snapshot or downgrading their version', () => {
    const f = fixture()
    f.db.sqlite.exec('PRAGMA user_version = 99')
    expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('newer ContextWeave')
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(99)
    expect(readdirSync(f.root).filter((name) => name.endsWith('.bak'))).toEqual([])
  })
  it('does not silently recreate missing tables in a versioned legacy database', () => {
    const f = fixture()
    f.db.sqlite.exec('DROP TABLE proxies; PRAGMA user_version = 1;')
    expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow()
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
    expect(
      f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'proxies'").get(),
    ).toBeUndefined()
  })
})
