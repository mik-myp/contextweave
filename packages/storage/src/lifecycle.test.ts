import { mkdtempSync, readdirSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import {
  EnvironmentRepository,
  openLocalDatabase,
  acquireRuntimeLock,
  runtimeLockPath,
} from './index'
const directories: string[] = []
const databases: ReturnType<typeof openLocalDatabase>[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-lifecycle-'))
  directories.push(root)
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  databases.push(db)
  return { root, db, repository: new EnvironmentRepository(db.sqlite) }
}
const config = environmentConfigSchema.parse({
  environmentId: 'env-a',
  name: 'Original',
  kernelId: 'standard-chromium',
  kernelVersion: 'local',
  commonConfig: {},
})
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
describe('configuration history and lifecycle', () => {
  it('keeps immutable revisions and rejects a stale editor without overwriting data', () => {
    const { repository, root } = fixture()
    repository.create({ config, dataDir: root, platform: 'darwin', arch: 'arm64' })
    repository.updateConfig({ ...config, name: 'Changed' }, 1)
    expect(() => repository.updateConfig({ ...config, name: 'Stale' }, 1)).toThrow(
      'CONFIG_CONFLICT',
    )
    expect(repository.get('env-a')?.revision).toBe(2)
    expect(JSON.parse(repository.getRevision('env-a', 1)!)).toEqual(config)
    expect(JSON.parse(repository.getRevision('env-a', 2)!).name).toBe('Changed')
    expect(repository.getRevision('env-a', 3)).toBeUndefined()
  })
  it('moves metadata to trash and restores the same identity without touching browser files', () => {
    const { repository, root } = fixture()
    writeFileSync(join(root, 'browser-data'), 'retained')
    const original = repository.create({ config, dataDir: root, platform: 'darwin', arch: 'arm64' })
    repository.deleteEnvironment('env-a')
    expect(repository.list()).toEqual([])
    expect(repository.listTrash()[0]?.environmentId).toBe(original.environmentId)
    expect(repository.restoreEnvironment('env-a')?.dataDir).toBe(root)
    expect(repository.get('env-a')?.revision).toBe(1)
    expect(readFileSync(join(root, 'browser-data'), 'utf8')).toBe('retained')
  })
  it('records actual session identity and terminal time, and recovers unfinished commands', () => {
    const { repository } = fixture()
    repository.createRuntimeSession({
      sessionId: 's',
      environmentId: 'env-a',
      pid: 100,
      controlPort: 10000,
      startedAt: new Date().toISOString(),
      status: 'running',
      exitReason: null,
      revision: 2,
      kernelVersion: 'local',
      executableVersion: '120.0.0.0',
    })
    repository.updateRuntimeSession('s', 'stopped', 'USER_STOPPED')
    const ended = repository.getRuntimeSession('s')!
    expect(ended.endedAt).toBeTruthy()
    expect(ended.revision).toBe(2)
    repository.updateRuntimeSession('s', 'stopped', 'USER_STOPPED')
    expect(repository.getRuntimeSession('s')?.endedAt).toBe(ended.endedAt)
    repository.createOperation('op', 'start', 'env-a')
    repository.recoverOperations()
    expect(repository.listOperations()[0]).toMatchObject({
      status: 'failed',
      errorCode: 'CLIENT_INTERRUPTED',
    })
  })
  it('does not steal an incomplete lock from another process', () => {
    const { root } = fixture()
    mkdirSync(runtimeLockPath(root))
    expect(
      acquireRuntimeLock(root, {
        pid: process.pid,
        sessionId: 'new',
        controlPort: 9000,
        startedAt: new Date().toISOString(),
      }).acquired,
    ).toBe(false)
  })
})
describe('legacy database migration', () => {
  it('backs up old metadata, preserves the exact configuration, and is repeatable', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-migration-'))
    directories.push(root)
    const file = join(root, 'old.sqlite'),
      legacy = new DatabaseSync(file)
    legacy.exec(
      `CREATE TABLE environments (environment_id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,kernel_id TEXT NOT NULL,kernel_version TEXT NOT NULL,proxy_id TEXT,config_json TEXT NOT NULL,data_dir TEXT NOT NULL,platform TEXT NOT NULL,arch TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    )
    const raw = JSON.stringify({ ...config, kernelConfig: { legacySetting: 'preserved' } })
    legacy
      .prepare('INSERT INTO environments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        'env-a',
        'Original',
        'stopped',
        'standard-chromium',
        'local',
        null,
        raw,
        join(root, 'existing-profile'),
        'darwin',
        'arm64',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    legacy.close()
    const migrated = openLocalDatabase(file),
      repository = new EnvironmentRepository(migrated.sqlite)
    expect(repository.getRevision('env-a', 1)).toBe(raw)
    expect(repository.get('env-a')?.dataDir).toBe(join(root, 'existing-profile'))
    migrated.close()
    const repeat = openLocalDatabase(file)
    repeat.close()
    const backups = readdirSync(root).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(root, backups[0]!))
    expect(backup.prepare('SELECT config_json FROM environments').get()?.config_json).toBe(raw)
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(0)
    backup.close()
  })
  it('refuses a database written by a newer application', () => {
    const { root } = fixture(),
      file = join(root, 'future.sqlite'),
      db = new DatabaseSync(file)
    db.exec('PRAGMA user_version = 99')
    db.close()
    expect(() => openLocalDatabase(file)).toThrow('newer ContextWeave')
  })
})

it('upgrades v1 proxy names without changing existing credentials, IDs or environment revisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-proxy-migration-'))
  directories.push(root)
  const file = join(root, 'data.sqlite')
  const previous = openLocalDatabase(file)
  const repository = new EnvironmentRepository(previous.sqlite)
  repository.create({ config, dataDir: root, platform: 'darwin', arch: 'arm64' })
  repository.saveProxy('p', { type: 'socks5', host: 'proxy.example.test', port: 1080, username: 'fixture', credentialRef: 'ref-preserved' })
  previous.sqlite.exec('ALTER TABLE runtime_sessions DROP COLUMN process_identity; DROP TABLE credential_cleanup; ALTER TABLE proxies DROP COLUMN name; PRAGMA user_version = 1;')
  previous.close()
  const migrated = openLocalDatabase(file); databases.push(migrated)
  const next = new EnvironmentRepository(migrated.sqlite)
  expect(next.getProxy('p')).toMatchObject({ name: 'proxy.example.test:1080', username: 'fixture', credentialRef: 'ref-preserved' })
  expect(next.get('env-a')?.revision).toBe(1)
  expect(readdirSync(root).some((name) => name.includes('.before-v4-'))).toBe(true)
})

it('fills a missing runtime identity only for the same starting session and PID', () => {
  const { repository, root } = fixture()
  repository.create({ config, dataDir: root, platform: 'darwin', arch: 'arm64' })
  const runtime = {
    sessionId: 'startup', environmentId: 'env-a', pid: 123, controlPort: 9000,
    startedAt: new Date().toISOString(), status: 'starting' as const, exitReason: null,
  }
  repository.createRuntimeSession(runtime)
  expect(repository.setRuntimeProcessIdentity('missing', 123, 'os:start')).toBe(false)
  expect(repository.setRuntimeProcessIdentity('startup', 456, 'os:start')).toBe(false)
  expect(repository.getRuntimeSession('startup')?.processIdentity).toBeUndefined()
  expect(repository.setRuntimeProcessIdentity('startup', 123, 'os:start')).toBe(true)
  expect(repository.setRuntimeProcessIdentity('startup', 123, 'os:replacement')).toBe(false)
  expect(repository.getRuntimeSession('startup')?.processIdentity).toBe('os:start')
  for (const status of ['running', 'stopping', 'stopped', 'crashed'] as const) {
    repository.createRuntimeSession({ ...runtime, sessionId: status, status })
    expect(repository.setRuntimeProcessIdentity(status, 123, 'os:start')).toBe(false)
    expect(repository.getRuntimeSession(status)?.processIdentity).toBeUndefined()
  }
})
