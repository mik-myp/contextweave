import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  architectureSchema,
  platformSchema,
  environmentStatusSchema,
  runtimeSessionSchema,
  operationKindSchema,
  operationSummarySchema,
  environmentConfigSchema,
} from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from './index'
import { openVersion4Fixture } from './legacy-fixture'
import { databaseVersion, migrateDatabase } from './migrations'

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
const tableNames = [
  'environments',
  'environment_revisions',
  'runtime_sessions',
  'operations',
  'proxies',
  'kernel_installations',
  'app_settings',
  'credential_cleanup',
] as const
function snapshot(sqlite: DatabaseSync) {
  return Object.fromEntries(
    tableNames.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]),
  )
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-integrity-v5-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'data.sqlite')
  const db = openVersion4Fixture(file)
  let closed = false
  const close = () => {
    if (!closed) {
      db.close()
      closed = true
    }
  }
  cleanups.push(close)
  const repository = new EnvironmentRepository(db.sqlite)
  const proxy = repository.saveProxy('p', {
    type: 'socks5',
    host: 'proxy.example.test',
    port: 1080,
    username: 'fixture',
    credentialRef: 'fixture-secret',
  })
  const config = environmentConfigSchema.parse({
    environmentId: 'env',
    name: 'Original',
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    proxyId: 'p',
    proxy,
    commonConfig: {},
    kernelConfig: { retained: 'unchanged' },
  })
  repository.create({ config, dataDir: join(root, 'profile'), platform: 'darwin', arch: 'arm64' })
  repository.updateConfig({ ...config, name: 'Revision 2' }, 1)
  repository.deleteEnvironment('env')
  repository.create({
    config: { ...config, environmentId: 'other', proxyId: undefined, proxy: undefined },
    dataDir: join(root, 'other'),
    platform: 'win32',
    arch: 'x64',
  })
  const session = {
    sessionId: 's',
    environmentId: 'env',
    pid: 123,
    controlPort: 9000,
    status: 'stopped' as const,
    startedAt: '2026-09-24T00:00:00.000Z',
    exitReason: null,
    revision: 2,
  }
  repository.createRuntimeSession(session)
  repository.createRuntimeSession({ ...session, sessionId: 'legacy', revision: undefined })
  repository.createOperation('missing', 'start', 'missing-environment')
  repository.createOperation('install', 'install', 'kernel:standard-chromium:local')
  repository.scheduleCredentialCleanup('retired-ref')
  repository.setSetting('keep', { nested: ['fixture'] })
  db.sqlite
    .exec(`INSERT INTO kernel_installations(id,kernel_id,version,platform,arch,install_path,state,created_at,updated_at)
    VALUES (1000,'standard-chromium','local','darwin','arm64','fixture','installed','2026-01-01','2026-01-01');
    DELETE FROM kernel_installations; PRAGMA wal_autocheckpoint = 0;`)
  return { root, file, sqlite: db.sqlite, repository, close, config }
}
function assertRolledBack(f: ReturnType<typeof fixture>, before: ReturnType<typeof snapshot>) {
  expect(f.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
  expect(f.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  expect(snapshot(f.sqlite)).toEqual(before)
  expect(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'next_*'").all()).toEqual(
    [],
  )
  const files = readdirSync(f.root).filter((name) => name.endsWith('.bak'))
  expect(files).toHaveLength(1)
  const backup = new DatabaseSync(join(f.root, files[0]!))
  try {
    expect(snapshot(backup)).toEqual(before)
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
  } finally {
    backup.close()
  }
}

describe('v5 lossless migration and recovery', () => {
  it('preserves WAL data, raw snapshots, trash, nullable legacy history, and AUTOINCREMENT high water', () => {
    const f = fixture(),
      before = snapshot(f.sqlite)
    migrateDatabase(f.sqlite, f.file)
    expect(snapshot(f.sqlite)).toEqual(before)
    expect(f.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
    expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(f.sqlite.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok')
    expect(f.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
    const backupName = readdirSync(f.root).find((name) => name.endsWith('.bak'))!
    const backup = new DatabaseSync(join(f.root, backupName))
    try {
      expect(snapshot(backup)).toEqual(before)
      expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
    } finally {
      backup.close()
    }
    expect(
      f.repository.recordKernelInstallation({
        kernelId: 'standard-chromium',
        version: 'local',
        platform: 'darwin',
        arch: 'arm64',
        sourceUrl: null,
        sha256: null,
        installPath: 'fixture',
        state: 'installed',
      }).id,
    ).toBe(1001)
    expect(f.repository.restoreEnvironment('env')?.revision).toBe(2)
    expect(f.repository.updateConfig({ ...f.config, name: 'Third' }, 2)?.revision).toBe(3)
    f.close()
    const reopened = openLocalDatabase(f.file)
    try {
      expect(new EnvironmentRepository(reopened.sqlite).get('env')?.revision).toBe(3)
    } finally {
      reopened.close()
    }
    expect(readdirSync(f.root).filter((name) => name.endsWith('.bak'))).toHaveLength(1)
  })

  it.each([
    "UPDATE environments SET proxy_id = 'missing' WHERE environment_id = 'env'",
    "DELETE FROM environment_revisions WHERE environment_id = 'env' AND revision = 2",
    "UPDATE environment_revisions SET environment_id = 'missing' WHERE environment_id = 'other'",
    "UPDATE runtime_sessions SET environment_id = 'missing' WHERE session_id = 's'",
    "UPDATE runtime_sessions SET environment_id = 'other' WHERE session_id = 's'",
    "UPDATE environments SET config_json = '{}' WHERE environment_id = 'env'",
    'UPDATE proxies SET port = 0',
    'UPDATE proxies SET port = 1.25',
    "UPDATE proxies SET type = 'unknown'",
    "UPDATE proxies SET proxy_id = NULL WHERE proxy_id = 'p'",
    'UPDATE runtime_sessions SET pid = 0',
    "UPDATE runtime_sessions SET status = 'invented'",
    "UPDATE environments SET platform = 'invalid'",
    "UPDATE environments SET lifecycle = 'active' WHERE lifecycle = 'trashed'",
    "UPDATE environment_revisions SET config_json = 'fixture-secret' WHERE environment_id = 'env'; UPDATE environments SET config_json = 'fixture-secret' WHERE environment_id = 'env'",
    "UPDATE app_settings SET value_json = 'fixture-secret'",
    "UPDATE operations SET kind = 'arbitrary-command'",
  ])('rejects invalid legacy data without repairing or losing it (%#)', (mutation) => {
    const f = fixture()
    f.sqlite.exec(mutation)
    const before = snapshot(f.sqlite)
    expect(() => migrateDatabase(f.sqlite, f.file)).toThrow('DATABASE_INTEGRITY_FAILED')
    assertRolledBack(f, before)
  })

  it.each([
    'ALTER TABLE proxies ADD COLUMN custom_data TEXT',
    'CREATE TABLE custom_data (value TEXT)',
    'CREATE INDEX custom_index ON proxies(host)',
    'CREATE TRIGGER custom_trigger AFTER UPDATE ON proxies BEGIN SELECT 1; END',
    'CREATE VIEW custom_view AS SELECT host FROM proxies',
    'DROP INDEX idx_environments_updated_at; CREATE INDEX idx_environments_updated_at ON environments(name)',
  ])('refuses an unknown schema rather than silently dropping it (%#)', (mutation) => {
    const f = fixture()
    f.sqlite.exec(mutation)
    const before = snapshot(f.sqlite)
    const schema = f.sqlite.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()
    expect(() => migrateDatabase(f.sqlite, f.file)).toThrow('DATABASE_SCHEMA_UNSUPPORTED')
    assertRolledBack(f, before)
    expect(f.sqlite.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()).toEqual(schema)
  })

  it.each(['replace', 'commit'])(
    'restores old tables, data, sequence, and enforcement on %s failure',
    (phase) => {
      const f = fixture(),
        before = snapshot(f.sqlite)
      const sequence = f.sqlite.prepare('SELECT * FROM sqlite_sequence').all()
      const exec = f.sqlite.exec.bind(f.sqlite)
      const fault = vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
        if (phase === 'commit' && sql === 'COMMIT') throw new Error('injected commit fault')
        exec(sql)
        if (phase === 'replace' && sql === 'ALTER TABLE next_environments RENAME TO environments')
          throw new Error('injected replacement fault')
      })
      expect(() => migrateDatabase(f.sqlite, f.file)).toThrow('injected')
      assertRolledBack(f, before)
      expect(f.sqlite.prepare('SELECT * FROM sqlite_sequence').all()).toEqual(sequence)
      fault.mockRestore()
      migrateDatabase(f.sqlite, f.file)
      expect(snapshot(f.sqlite)).toEqual(before)
    },
  )

  it.each(['foreign-key', 'snapshot'])(
    'refuses a tampered current database on reopen (%s)',
    (kind) => {
      const f = fixture()
      migrateDatabase(f.sqlite, f.file)
      if (kind === 'foreign-key') f.sqlite.exec('PRAGMA foreign_keys = OFF; DELETE FROM proxies;')
      else f.sqlite.exec("UPDATE environments SET config_json = '{}' WHERE environment_id = 'env'")
      const before = snapshot(f.sqlite)
      f.close()
      expect(() => openLocalDatabase(f.file)).toThrow('DATABASE_INTEGRITY_FAILED')
      const raw = new DatabaseSync(f.file)
      try {
        expect(snapshot(raw)).toEqual(before)
        expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
      } finally {
        raw.close()
      }
    },
  )
})

describe('database-enforced relations and values', () => {
  it.each([
    "DELETE FROM proxies WHERE proxy_id = 'p'",
    "DELETE FROM environments WHERE environment_id = 'env'",
    "DELETE FROM environment_revisions WHERE environment_id = 'env' AND revision = 2",
    "UPDATE runtime_sessions SET environment_id = 'missing' WHERE session_id = 's'",
    "UPDATE runtime_sessions SET environment_id = 'other' WHERE session_id = 's'",
    "UPDATE environments SET status = 'invalid'",
    'UPDATE environments SET environment_id = NULL',
    "UPDATE environments SET arch = 'x86'",
    "UPDATE environments SET lifecycle = 'active' WHERE environment_id = 'env'",
    'UPDATE environments SET revision = 0',
    "UPDATE environment_revisions SET config_json = '[]'",
    "UPDATE environment_revisions SET config_json = 'invalid'",
    'UPDATE runtime_sessions SET control_port = 65536',
    'UPDATE runtime_sessions SET control_port = 1.1',
    'UPDATE runtime_sessions SET pid = -1',
    "UPDATE runtime_sessions SET status = 'unknown'",
    "UPDATE runtime_sessions SET process_identity = ''",
    "UPDATE proxies SET type = 'SOCKET5'",
    'UPDATE proxies SET port = 65536',
    "UPDATE app_settings SET value_json = 'bad'",
    "UPDATE operations SET status = 'unknown'",
    "UPDATE credential_cleanup SET credential_ref = ''",
  ])('rejects bypassing repository validation through direct SQL (%#)', (sql) => {
    const f = fixture()
    migrateDatabase(f.sqlite, f.file)
    const before = snapshot(f.sqlite)
    expect(() => f.sqlite.exec(sql)).toThrow()
    expect(snapshot(f.sqlite)).toEqual(before)
    expect(f.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })

  it('enforces the current revision at COMMIT while permitting atomic create/update transactions', () => {
    const f = fixture()
    migrateDatabase(f.sqlite, f.file)
    f.sqlite.exec(
      "BEGIN IMMEDIATE; UPDATE environments SET revision = 999 WHERE environment_id = 'env'",
    )
    expect(() => f.sqlite.exec('COMMIT')).toThrow()
    f.sqlite.exec('ROLLBACK')
    expect(f.repository.get('env')?.revision).toBe(2)
    expect(f.repository.updateConfig({ ...f.config, name: 'Atomic' }, 2)?.revision).toBe(3)
    expect(f.repository.getRevision('env', 3)).toBe(f.repository.get('env')?.configJson)
  })
})

it('accepts every current contract enum and both port boundaries without loosening numeric checks', () => {
  const f = fixture()
  migrateDatabase(f.sqlite, f.file)
  for (const status of environmentStatusSchema.options) f.repository.updateStatus('env', status)
  for (const status of runtimeSessionSchema.shape.status.options)
    f.repository.updateRuntimeSession('s', status)
  for (const kind of operationKindSchema.options)
    f.repository.createOperation(`operation-${kind}`, kind, 'failed-or-kernel-key')
  for (const status of operationSummarySchema.shape.status.options)
    f.repository.updateOperation('missing', 'fixture', status)
  for (const platform of platformSchema.options)
    f.sqlite.prepare('UPDATE environments SET platform = ?').run(platform)
  for (const arch of architectureSchema.options)
    f.sqlite.prepare('UPDATE environments SET arch = ?').run(arch)
  for (const port of [1, 65535])
    f.repository.saveProxy('p', { type: 'http', host: 'proxy.example.test', port })
  expect(() => f.sqlite.exec('UPDATE runtime_sessions SET pid = 9007199254740992')).toThrow()
})

it('fails closed when foreign key restoration is unavailable, without claiming an already committed migration rolled back', () => {
  const f = fixture()
  const exec = f.sqlite.exec.bind(f.sqlite)
  const fault = vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
    if (sql === 'PRAGMA foreign_keys = ON') return
    exec(sql)
  })
  expect(() => migrateDatabase(f.sqlite, f.file)).toThrow('DATABASE_FOREIGN_KEYS_UNAVAILABLE')
  // Table publication committed before the connection-level restoration attempt.
  expect(f.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
  expect(readdirSync(f.root).filter((name) => name.endsWith('.bak'))).toHaveLength(1)
  fault.mockRestore()
  f.close()
  const reopened = openLocalDatabase(f.file)
  try {
    expect(reopened.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  } finally {
    reopened.close()
  }
})
