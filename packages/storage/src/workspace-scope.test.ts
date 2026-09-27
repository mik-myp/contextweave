import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import { EnvironmentRepository, WorkspaceRepository, openLocalDatabase } from './index'
import { migrateDatabase, databaseVersion } from './migrations'
import { legacyFixtureWriter, legacyRows, openVersion9Fixture } from './legacy-fixture'
import { workspaceTables } from './workspace-scope'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const clean of cleanup.splice(0).reverse()) clean()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-scope-migration-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'workspace.sqlite')
  const db = openVersion9Fixture(file)
  cleanup.push(() => {
    if (db.sqlite.isOpen) db.close()
  })
  const legacy = legacyFixtureWriter(db.sqlite)
  const proxy = legacy.saveProxy('same-proxy', {
    type: 'http',
    host: 'proxy.invalid',
    port: 8080,
    credentialRef: 'unchanged-key',
  })
  legacy.create({
    config: environmentConfigSchema.parse({
      environmentId: 'same-id',
      name: 'Same display name',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
      proxyId: 'same-proxy',
      proxy,
    }),
    dataDir: join(root, 'environments', 'same-id'),
    platform: 'darwin',
    arch: 'arm64',
  })
  legacy.createRuntimeSession({
    sessionId: 'same-session',
    environmentId: 'same-id',
    pid: 1,
    controlPort: 9000,
    status: 'stopped',
    startedAt: '2026-09-27T00:00:00.000Z',
    exitReason: null,
  })
  legacy.createOperation('same-operation', 'start', 'same-id')
  legacy.scheduleCredentialCleanup('retired-key')
  writeFileSync(join(root, 'credentials.json'), 'unchanged encrypted bytes')
  const identity = new WorkspaceRepository(db.sqlite).current()
  const snapshot = () =>
    Object.fromEntries(workspaceTables.map((table) => [table, legacyRows(db.sqlite, table)]))
  return { root, file, db, identity, snapshot, before: snapshot() }
}
it('upgrades the actual tagged v9 schema once, preserving every legacy column, UUID, key and file', () => {
  const f = fixture()
  expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
  migrateDatabase(f.db.sqlite, f.file)
  expect(f.snapshot()).toEqual(f.before)
  expect(new WorkspaceRepository(f.db.sqlite).current()).toEqual(f.identity)
  for (const table of workspaceTables) {
    const columns = f.db.sqlite.prepare(`PRAGMA table_info(${table})`).all()
    expect(columns.find((row) => row.name === 'workspace_id')).toMatchObject({
      notnull: 1,
      dflt_value: `'${f.identity.workspaceId}'`,
    })
    expect(
      f.db.sqlite
        .prepare(`SELECT 1 FROM ${table} WHERE workspace_id != ?`)
        .get(f.identity.workspaceId),
    ).toBeUndefined()
    expect(f.db.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()).toContainEqual(
      expect.objectContaining({
        table: 'local_workspace',
        from: 'workspace_id',
        to: 'workspace_id',
      }),
    )
  }
  const repository = new EnvironmentRepository(f.db.sqlite)
  expect(repository.get('same-id')?.workspaceId).toBe(f.identity.workspaceId)
  expect(repository.getProxy('same-proxy')?.workspaceId).toBe(f.identity.workspaceId)
  expect(repository.getRuntimeSession('same-session')?.workspaceId).toBe(f.identity.workspaceId)
  expect(repository.listOperations()[0]?.workspaceId).toBe(f.identity.workspaceId)
  expect(readFileSync(join(f.root, 'credentials.json'), 'utf8')).toBe('unchanged encrypted bytes')
  migrateDatabase(f.db.sqlite, f.file)
  const backups = readdirSync(f.root).filter((name) => name.endsWith('.bak'))
  expect(backups).toHaveLength(1)
  const backup = new DatabaseSync(join(f.root, backups[0]!))
  try {
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
    expect(legacyRows(backup, 'environments')).toEqual(f.before.environments)
  } finally {
    backup.close()
  }
  f.db.close()
  const reopened = openLocalDatabase(f.file)
  try {
    expect(new WorkspaceRepository(reopened.sqlite).current()).toEqual(f.identity)
  } finally {
    reopened.close()
  }
})
it.each(['DDL', 'COMMIT'] as const)(
  'rolls back %s without relabeling the v9 owner or business data',
  (phase) => {
    const f = fixture(),
      exec = f.db.sqlite.exec.bind(f.db.sqlite)
    const fault = vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
      if (phase === 'DDL' && sql.startsWith('ALTER TABLE runtime_sessions ADD')) {
        exec(sql)
        throw new Error('injected scope DDL')
      }
      if (phase === 'COMMIT' && sql === 'COMMIT') throw new Error('injected scope commit')
      exec(sql)
    })
    expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('injected')
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
    expect(f.snapshot()).toEqual(f.before)
    expect(new WorkspaceRepository(f.db.sqlite).current()).toEqual(f.identity)
    for (const table of workspaceTables)
      expect(
        f.db.sqlite
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((row) => row.name === 'workspace_id'),
      ).toBe(false)
    fault.mockRestore()
    migrateDatabase(f.db.sqlite, f.file)
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
  },
)
it('rejects foreign and NULL ownership via direct SQL, even when FK checks are disabled', () => {
  const f = fixture()
  migrateDatabase(f.db.sqlite, f.file)
  f.db.sqlite.exec('PRAGMA foreign_keys=OFF')
  for (const table of [
    'environments',
    'environment_revisions',
    'proxies',
    'runtime_sessions',
    'operations',
    'credential_cleanup',
    'screenshot_budget',
  ]) {
    for (const owner of [randomUUID(), null])
      expect(() => f.db.sqlite.prepare(`UPDATE ${table} SET workspace_id=?`).run(owner)).toThrow()
  }
  f.db.sqlite.exec('PRAGMA foreign_keys=ON')
  expect(f.snapshot()).toEqual(f.before)
})
it('rejects a foreign session before it can be stored under a matching environment ID', () => {
  const f = fixture()
  migrateDatabase(f.db.sqlite, f.file)
  const repo = new EnvironmentRepository(f.db.sqlite),
    before = repo.listRuntimeSessions()
  expect(() =>
    repo.createRuntimeSession({ ...before[0]!, sessionId: 'foreign', workspaceId: randomUUID() }),
  ).toThrow('WORKSPACE_MISMATCH')
  expect(repo.listRuntimeSessions()).toEqual(before)
})
