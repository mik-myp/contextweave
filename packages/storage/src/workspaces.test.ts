import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { environmentConfigSchema, localWorkspaceSchema } from '@contextweave/contracts'
import {
  ArtifactRepository,
  EnvironmentRepository,
  WorkspaceRepository,
  openLocalDatabase,
} from './index'
import { databaseVersion, migrateDatabase } from './migrations'
import { openVersion8Fixture } from './legacy-fixture'
const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0).reverse()) clean()
})
function track(sqlite: DatabaseSync) {
  cleanups.push(() => {
    if (sqlite.isOpen) sqlite.close()
  })
  return sqlite
}
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'cw-workspace-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function baseline() {
  const root = directory(),
    file = join(root, 'contextweave.sqlite')
  const sqlite = track(openVersion8Fixture(file).sqlite)
  const repo = new EnvironmentRepository(sqlite)
  const profile = join(root, 'environments', 'existing')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'retained-session'), 'browser bytes stay in place')
  writeFileSync(join(root, 'credentials.json'), 'opaque encrypted credential fixture')
  repo.saveProxy('proxy', {
    name: 'Original proxy',
    type: 'http',
    host: '127.0.0.1',
    port: 8181,
    credentialRef: 'credential-owned-reference',
  })
  const config = environmentConfigSchema.parse({
    environmentId: 'existing',
    name: 'Existing',
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    commonConfig: {},
    proxyId: 'proxy',
    proxy: {
      type: 'http',
      host: '127.0.0.1',
      port: 8181,
      credentialRef: 'credential-owned-reference',
    },
  })
  repo.create({ config, dataDir: profile, platform: 'darwin', arch: 'arm64' })
  repo.updateConfig({ ...config, name: 'Retained revision' }, 1)
  repo.createRuntimeSession({
    sessionId: 'old-session',
    environmentId: 'existing',
    pid: 100,
    controlPort: 9284,
    startedAt: '2026-09-27T00:00:00.000Z',
    status: 'stopped',
    exitReason: 'USER_STOPPED',
    revision: 2,
  })
  repo.createOperation('old-operation', 'start', 'existing')
  repo.updateOperation('old-operation', 'completed', 'succeeded')
  repo.scheduleCredentialCleanup('pending-reference')
  repo.setSetting('fixture', { retained: true })
  const artifacts = new ArtifactRepository(sqlite)
  artifacts.updateBudget({ limitMiB: 64, expectedRevision: 1 })
  artifacts.reserve({
    artifactId: randomUUID(),
    environmentId: 'existing',
    taskId: 'uncertain-task',
    reservedAt: '2026-09-27T00:00:00.000Z',
  })
  const artifactId = randomUUID()
  const ownership = {
    version: 1 as const,
    root: { dev: '1', ino: '2', birthtimeNs: '3' },
    directory: { dev: '1', ino: '4', birthtimeNs: '5' },
    file: { dev: '1', ino: '6', birthtimeNs: '7' },
  }
  artifacts.reserve({
    artifactId,
    environmentId: 'existing',
    taskId: 'completed-task',
    reservedAt: '2026-09-27T00:00:00.000Z',
  })
  artifacts.bindAllocation({ artifactId, allocationName: 'run-Ab1234', ownership })
  artifacts.registerArtifact({
    artifactId,
    environmentId: 'existing',
    taskId: 'completed-task',
    allocationName: 'run-Ab1234',
    ownership,
    bytes: 8,
    sha256: 'a'.repeat(64),
    completedAt: '2026-09-27T00:00:00.000Z',
  })
  repo.deleteEnvironment('existing')
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name))
  const snapshot = () =>
    Object.fromEntries(
      tables.map((table) => [
        table,
        sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
      ]),
    )
  return { root, file, sqlite, profile, snapshot, before: snapshot() }
}
it('adopts a real v8 database without changing any business row, secret reference or browser bytes', () => {
  const f = baseline()
  expect(f.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
  migrateDatabase(f.sqlite, f.file)
  const identity = new WorkspaceRepository(f.sqlite).current()
  expect(localWorkspaceSchema.safeParse(identity).success).toBe(true)
  expect(f.snapshot()).toEqual(f.before)
  expect(readFileSync(join(f.profile, 'retained-session'), 'utf8')).toBe(
    'browser bytes stay in place',
  )
  expect(readFileSync(join(f.root, 'credentials.json'), 'utf8')).toBe(
    'opaque encrypted credential fixture',
  )
  const backups = readdirSync(f.root).filter((name) => name.includes('.before-v9-'))
  expect(backups).toHaveLength(1)
  const before = track(new DatabaseSync(join(f.root, backups[0]!)))
  expect(before.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
  for (const [table, rows] of Object.entries(f.before))
    expect(before.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(rows)
  expect(
    before.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_workspace'").get(),
  ).toBeUndefined()
  migrateDatabase(f.sqlite, f.file)
  expect(readdirSync(f.root).filter((name) => name.endsWith('.bak'))).toHaveLength(1)
  const second = track(openLocalDatabase(f.file).sqlite)
  expect(new WorkspaceRepository(second).current()).toEqual(identity)
  second.close()
  f.sqlite.close()
  const reopened = track(openLocalDatabase(f.file).sqlite)
  expect(new WorkspaceRepository(reopened).current()).toEqual(identity)
})
it('creates different identities for independent databases and preserves identity in a complete database copy', () => {
  const root = directory(),
    file = join(root, 'one.sqlite')
  const one = track(openLocalDatabase(file).sqlite),
    two = track(openLocalDatabase(join(root, 'two.sqlite')).sqlite)
  const identity = new WorkspaceRepository(one).current()
  expect(new WorkspaceRepository(two).current().workspaceId).not.toBe(identity.workspaceId)
  one.close()
  const copy = join(root, 'copy.sqlite')
  copyFileSync(file, copy)
  const restored = track(openLocalDatabase(copy).sqlite)
  expect(new WorkspaceRepository(restored).current()).toEqual(identity)
  expect(new WorkspaceRepository(restored).current()).not.toBe(identity)
})
it.each(['DDL', 'COMMIT', 'ROLLBACK'] as const)(
  'preserves the old database after %s failure and can retry the migration',
  (phase) => {
    const f = baseline(),
      exec = f.sqlite.exec.bind(f.sqlite)
    const fault = vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
      if (
        (phase === 'DDL' && sql.includes('CREATE TABLE local_workspace')) ||
        (phase !== 'DDL' && sql === 'COMMIT') ||
        (phase === 'ROLLBACK' && sql === 'ROLLBACK')
      )
        throw new Error('injected failure')
      return exec(sql)
    })
    expect(() => migrateDatabase(f.sqlite, f.file)).toThrow()
    fault.mockRestore()
    f.sqlite.close()
    const raw = track(new DatabaseSync(f.file))
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
    expect(
      raw.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_workspace'").get(),
    ).toBeUndefined()
    for (const [table, rows] of Object.entries(f.before))
      expect(raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(rows)
    raw.close()
    const retried = track(openLocalDatabase(f.file).sqlite)
    expect(retried.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
    expect(localWorkspaceSchema.safeParse(new WorkspaceRepository(retried).current()).success).toBe(
      true,
    )
  },
)
it('rechecks the schema under the write lock and keeps the identity committed by a competing migrator', () => {
  const f = baseline(),
    exec = f.sqlite.exec.bind(f.sqlite)
  let otherId: string | undefined
  vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
    if (sql === 'BEGIN IMMEDIATE' && !otherId) {
      const other = track(openLocalDatabase(f.file).sqlite)
      otherId = new WorkspaceRepository(other).current().workspaceId
      other.close()
    }
    return exec(sql)
  })
  migrateDatabase(f.sqlite, f.file)
  expect(new WorkspaceRepository(f.sqlite).current().workspaceId).toBe(otherId)
  expect(f.snapshot()).toEqual(f.before)
})
it('does not create an identity while another writer owns the database', () => {
  const f = baseline(),
    writer = track(new DatabaseSync(f.file))
  writer.exec('BEGIN IMMEDIATE')
  try {
    expect(() => migrateDatabase(f.sqlite, f.file)).toThrow()
  } finally {
    writer.exec('ROLLBACK')
  }
  expect(f.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
  expect(
    f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_workspace'").get(),
  ).toBeUndefined()
  migrateDatabase(f.sqlite, f.file)
  expect(new WorkspaceRepository(f.sqlite).current().storageMode).toBe('local')
})
it('prohibits deleting, changing, replacing or inserting another database owner', () => {
  const db = track(openLocalDatabase(':memory:').sqlite),
    repo = new WorkspaceRepository(db)
  const before = repo.current()
  for (const sql of [
    'DELETE FROM local_workspace',
    `UPDATE local_workspace SET workspace_id='${randomUUID()}'`,
    "UPDATE local_workspace SET storage_mode='postgresql'",
    `INSERT OR REPLACE INTO local_workspace VALUES(1,'${randomUUID()}','personal','local','2026-09-27T00:00:00.000Z')`,
    `INSERT INTO local_workspace VALUES(2,'${randomUUID()}','personal','local','2026-09-27T00:00:00.000Z')`,
  ])
    expect(() => db.exec(sql)).toThrow()
  expect(repo.current()).toEqual(before)
})
it.each(['missing', 'invalid', 'table-missing'] as const)(
  'fails closed on %s ownership without recreating data or identity',
  (mode) => {
    const file = join(directory(), 'data.sqlite'),
      db = track(openLocalDatabase(file).sqlite)
    db.exec('DROP TRIGGER local_workspace_no_delete; DROP TRIGGER local_workspace_no_update;')
    if (mode === 'missing') db.exec('DELETE FROM local_workspace')
    else if (mode === 'table-missing') db.exec('DROP TABLE local_workspace')
    else
      db.exec(
        "PRAGMA ignore_check_constraints=ON; UPDATE local_workspace SET workspace_id='invalid-keep-original'; PRAGMA ignore_check_constraints=OFF;",
      )
    db.close()
    expect(() => openLocalDatabase(file)).toThrow()
    const raw = track(new DatabaseSync(file))
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
    if (mode === 'invalid')
      expect(raw.prepare('SELECT workspace_id FROM local_workspace').get()?.workspace_id).toBe(
        'invalid-keep-original',
      )
    else if (mode === 'missing')
      expect(raw.prepare('SELECT * FROM local_workspace').all()).toEqual([])
    else
      expect(
        raw.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_workspace'").get(),
      ).toBeUndefined()
  },
)
it('does not adopt an unexpected pre-existing ownership table in an old schema', () => {
  const f = baseline()
  f.sqlite.exec(
    "CREATE TABLE local_workspace (unexpected TEXT); INSERT INTO local_workspace VALUES ('retain');",
  )
  expect(() => migrateDatabase(f.sqlite, f.file)).toThrow()
  expect(f.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
  expect(f.sqlite.prepare('SELECT * FROM local_workspace').all()).toEqual([
    { unexpected: 'retain' },
  ])
  expect(f.snapshot()).toEqual(f.before)
})

it('keeps a committed identity when the COMMIT acknowledgement is lost and startup retries', () => {
  const f = baseline(),
    exec = f.sqlite.exec.bind(f.sqlite)
  const fault = vi.spyOn(f.sqlite, 'exec').mockImplementation((sql) => {
    const result = exec(sql)
    if (sql === 'COMMIT') throw new Error('lost acknowledgement after commit')
    return result
  })
  expect(() => migrateDatabase(f.sqlite, f.file)).toThrow()
  fault.mockRestore()
  const committed = new WorkspaceRepository(f.sqlite).current()
  expect(f.snapshot()).toEqual(f.before)
  f.sqlite.close()
  const reopened = track(openLocalDatabase(f.file).sqlite)
  expect(new WorkspaceRepository(reopened).current()).toEqual(committed)
})
