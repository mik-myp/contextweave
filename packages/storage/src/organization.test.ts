import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { environmentConfigSchema, type EnvironmentView } from '@contextweave/contracts'
import { openLocalDatabase, EnvironmentRepository, WorkspaceRepository } from './index'
import { openVersion10Fixture, legacyFixtureWriter } from './legacy-fixture'
import { migrateDatabase, databaseVersion } from './migrations'
import { organizationTables } from './organization-schema'
const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0).reverse()) clean()
})
function root() {
  const d = mkdtempSync(join(tmpdir(), 'cw-organization-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}
function track(db: { sqlite: DatabaseSync; close: () => void }) {
  cleanups.push(() => {
    if (db.sqlite.isOpen) db.close()
  })
  return db
}
function config() {
  return environmentConfigSchema.parse({
    environmentId: 'same-id',
    name: 'Same name',
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    commonConfig: {},
  })
}
function fixture() {
  const d = root(),
    file = join(d, 'workspace.sqlite'),
    db = track(openLocalDatabase(file)),
    repo = new EnvironmentRepository(db.sqlite)
  repo.create({ config: config(), dataDir: join(d, 'same-id'), platform: 'darwin', arch: 'arm64' })
  return { d, file, db, repo, organization: repo.organization }
}
const view: EnvironmentView = {
  version: 1,
  search: 'review',
  filters: {
    statuses: ['stopped'],
    kernelIds: ['standard-chromium'],
    proxyIds: [],
    groupIds: [],
    tags: ['review'],
  },
  sorting: [{ id: 'name', desc: false }],
  hiddenColumns: ['note'],
}
const annotation = {
  environmentId: 'same-id',
  groupId: null,
  tags: ['Review', '中文'],
  note: 'Keep original session',
  expectedRevision: 0,
}
describe('environment organization', () => {
  it('round-trips groups, tags, notes and named views without changing browser configuration/revision', () => {
    const f = fixture(),
      before = f.repo.get('same-id')
    const g = f.organization.createGroup({ name: '  Équipe  ' })
    expect(() => f.organization.createGroup({ name: 'e\u0301quipe' })).toThrow(
      'ORGANIZATION_NAME_EXISTS',
    )
    const saved = f.organization.saveEnvironment({ ...annotation, groupId: g.id })
    expect(saved).toMatchObject({ revision: 1, groupId: g.id, tags: ['Review', '中文'] })
    const v = f.organization.createView({ name: 'My review', view })
    expect(() => f.organization.createView({ name: 'MY REVIEW', view })).toThrow(
      'ORGANIZATION_NAME_EXISTS',
    )
    expect(f.repo.get('same-id')).toEqual(before)
    const snapshot = f.organization.snapshot()
    f.db.close()
    const again = track(openLocalDatabase(f.file))
    expect(new EnvironmentRepository(again.sqlite).organization.snapshot()).toEqual(snapshot)
    expect(snapshot.views).toEqual([v])
  })
  it('uses revisions for edits/deletes, detaches atomically and preserves recycled metadata', () => {
    const f = fixture(),
      g = f.organization.createGroup({ name: 'Group' })
    f.organization.saveEnvironment({ ...annotation, groupId: g.id })
    expect(() => f.organization.saveEnvironment(annotation)).toThrow('ORGANIZATION_CONFLICT')
    const renamed = f.organization.updateGroup({ id: g.id, name: 'Renamed', expectedRevision: 1 })
    expect(renamed.revision).toBe(2)
    expect(() => f.organization.deleteGroup({ id: g.id, expectedRevision: 1 })).toThrow(
      'ORGANIZATION_CONFLICT',
    )
    f.db.sqlite
      .prepare(
        "UPDATE environments SET lifecycle='trashed', trashed_at=? WHERE environment_id='same-id'",
      )
      .run(new Date().toISOString())
    expect(() => f.organization.saveEnvironment({ ...annotation, expectedRevision: 1 })).toThrow(
      'NOT_FOUND',
    )
    f.organization.deleteGroup({ id: g.id, expectedRevision: 2 })
    const meta = f.organization.snapshot().environments[0]
    expect(meta).toMatchObject({
      groupId: null,
      tags: annotation.tags,
      note: annotation.note,
      revision: 2,
    })
    expect(f.repo.get('same-id')?.lifecycle).toBe('trashed')
    f.db.sqlite.exec(
      "UPDATE environments SET lifecycle='active', trashed_at=NULL WHERE environment_id='same-id'",
    )
    expect(f.organization.snapshot().environments[0]).toEqual(meta)
    expect(() => f.organization.saveEnvironment({ ...annotation, expectedRevision: 1 })).toThrow(
      'ORGANIZATION_CONFLICT',
    )
    expect(() =>
      f.organization.saveEnvironment({ ...annotation, expectedRevision: 2, groupId: g.id }),
    ).toThrow('ORGANIZATION_GROUP_MISSING')
  })
  it('rolls group detach back if deletion fails, leaving unique user data intact', () => {
    const f = fixture(),
      g = f.organization.createGroup({ name: 'Do not partially delete' })
    f.organization.saveEnvironment({ ...annotation, groupId: g.id })
    f.db.sqlite.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON environment_groups BEGIN SELECT RAISE(ABORT,'injected delete failure'); END",
    )
    const before = f.organization.snapshot()
    expect(() => f.organization.deleteGroup({ id: g.id, expectedRevision: 1 })).toThrow(
      'injected delete failure',
    )
    expect(f.organization.snapshot()).toEqual(before)
    expect(f.db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('updates and deletes only a revision-matching view, never its environments', () => {
    const f = fixture(),
      v = f.organization.createView({ name: 'Default', view })
    const second = f.organization.updateView({
      id: v.id,
      name: 'Renamed',
      view: { ...view, search: 'changed' },
      expectedRevision: 1,
    })
    expect(second).toMatchObject({ name: 'Renamed', revision: 2, view: { search: 'changed' } })
    expect(() =>
      f.organization.updateView({ id: v.id, name: 'Stale', view, expectedRevision: 1 }),
    ).toThrow('ORGANIZATION_CONFLICT')
    expect(() => f.organization.deleteView({ id: v.id, expectedRevision: 1 })).toThrow(
      'ORGANIZATION_CONFLICT',
    )
    f.organization.deleteView({ id: v.id, expectedRevision: 2 })
    expect(f.organization.snapshot().views).toEqual([])
    expect(f.repo.get('same-id')).toBeDefined()
  })
  it('isolates identical resource names/IDs in independent owner databases', () => {
    const a = fixture(),
      b = fixture()
    a.organization.saveEnvironment(annotation)
    a.organization.createGroup({ name: 'Identical' })
    b.organization.createGroup({ name: 'Identical' })
    a.organization.createView({ name: 'Identical', view })
    expect(b.organization.snapshot().environments[0]).toMatchObject({
      revision: 0,
      tags: [],
      note: '',
    })
    expect(b.organization.snapshot().views).toEqual([])
    expect(a.repo.workspaceId).not.toBe(b.repo.workspaceId)
    for (const table of organizationTables) {
      a.db.sqlite.exec('PRAGMA foreign_keys=OFF')
      expect(() =>
        a.db.sqlite.prepare(`UPDATE ${table} SET workspace_id=?`).run(b.repo.workspaceId),
      ).toThrow()
      a.db.sqlite.exec('PRAGMA foreign_keys=ON')
    }
    expect(a.organization.snapshot().environments[0]?.note).toBe(annotation.note)
  })
  it('refuses damaged organization records at reopen instead of resetting their content', () => {
    const f = fixture()
    f.organization.createView({ name: 'Preserve', view })
    f.db.sqlite.exec(`UPDATE environment_views SET view_json='{"rowSelection":{"private":true}}'`)
    f.db.close()
    expect(() => openLocalDatabase(f.file)).toThrow('DATABASE_INTEGRITY_FAILED')
    const raw = track({
      sqlite: new DatabaseSync(f.file),
      close() {
        this.sqlite.close()
      },
    })
    expect(
      raw.sqlite.prepare('SELECT view_json FROM environment_views').get()?.view_json,
    ).toContain('private')
  })
})

describe('published v10 upgrade', () => {
  function legacy() {
    const d = root(),
      file = join(d, 'workspace.sqlite'),
      db = track(openVersion10Fixture(file))
    legacyFixtureWriter(db.sqlite).create({
      config: config(),
      dataDir: join(d, 'same-id'),
      platform: 'darwin',
      arch: 'arm64',
    })
    writeFileSync(join(d, 'profile-fixture'), 'retained browser session')
    return { d, file, db }
  }
  it('preserves every original table, row, owner and file, snapshots WAL and migrates once', () => {
    const f = legacy(),
      identity = new WorkspaceRepository(f.db.sqlite).current()
    const tables = f.db.sqlite
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
    const oldRows = Object.fromEntries(
      tables.map((t) => [String(t.name), f.db.sqlite.prepare(`SELECT * FROM ${t.name}`).all()]),
    )
    migrateDatabase(f.db.sqlite, f.file)
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
    for (const t of tables) {
      expect(
        f.db.sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(String(t.name))?.sql,
      ).toBe(t.sql)
      expect(f.db.sqlite.prepare(`SELECT * FROM ${t.name}`).all()).toEqual(oldRows[String(t.name)])
    }
    expect(new EnvironmentRepository(f.db.sqlite).organization.snapshot()).toMatchObject({
      workspaceId: identity.workspaceId,
      groups: [],
      views: [],
      environments: [{ environmentId: 'same-id', groupId: null, tags: [], note: '', revision: 0 }],
    })
    migrateDatabase(f.db.sqlite, f.file)
    const backups = readdirSync(f.d).filter((x) => x.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = track({
      sqlite: new DatabaseSync(join(f.d, backups[0]!)),
      close() {
        this.sqlite.close()
      },
    })
    expect(backup.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(10)
    expect(backup.sqlite.prepare('SELECT * FROM environments').all()).toEqual(oldRows.environments)
    f.db.close()
    const reopened = track(openLocalDatabase(f.file))
    expect(new WorkspaceRepository(reopened.sqlite).current()).toEqual(identity)
    expect(readFileSync(join(f.d, 'profile-fixture'), 'utf8')).toBe('retained browser session')
  })
  it('rolls back injected partial v11 DDL and preserves v10 for a real retry', () => {
    const f = legacy(),
      exec = f.db.sqlite.exec.bind(f.db.sqlite)
    const spy = vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE environment_groups')) {
        exec('CREATE TABLE partial_new_table (id TEXT)')
        throw new Error('injected v11 failure')
      }
      exec(sql)
    })
    expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('injected v11 failure')
    spy.mockRestore()
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(10)
    expect(
      f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='partial_new_table'").get(),
    ).toBeUndefined()
    expect(f.db.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
    expect(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM environments').get()?.count).toBe(1)
    migrateDatabase(f.db.sqlite, f.file)
    expect(
      new EnvironmentRepository(f.db.sqlite).organization.snapshot().environments,
    ).toHaveLength(1)
  })
})
