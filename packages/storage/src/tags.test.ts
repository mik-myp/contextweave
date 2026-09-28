import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { environmentConfigSchema, tagsSchema, type EnvironmentView } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase, WorkspaceRepository } from './index'
import { legacyFixtureWriter, openVersion13Fixture } from './legacy-fixture'
import { migrateDatabase } from './migrations'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) close()
})
function track<T extends { sqlite: DatabaseSync; close: () => void }>(db: T) {
  cleanup.push(() => {
    if (db.sqlite.isOpen) db.close()
  })
  return db
}
function fixture(legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'cw-tags-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'workspace.sqlite')
  const db = track(legacy ? openVersion13Fixture(file) : openLocalDatabase(file))
  const config = environmentConfigSchema.parse({
    environmentId: 'env',
    name: 'Retained',
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    commonConfig: {},
  })
  legacyFixtureWriter(db.sqlite).create({
    config,
    dataDir: join(root, 'profile'),
    platform: 'darwin',
    arch: 'arm64',
  })
  writeFileSync(join(root, 'browser-data'), 'only browser session copy')
  const repo = new EnvironmentRepository(db.sqlite)
  return { root, file, db, repo, org: repo.organization }
}
const metadata = {
  environmentId: 'env',
  groupId: null,
  tags: ['Review', '中文'],
  note: 'Retain me',
  expectedRevision: 0,
}
const view: EnvironmentView = {
  version: 1,
  search: 'stable',
  filters: {
    statuses: ['stopped'],
    kernelIds: [],
    proxyIds: [],
    groupIds: [],
    tags: ['review', '中文'],
  },
  sorting: [{ id: 'name', desc: false }],
  hiddenColumns: ['note'],
}
const rows = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table}`).all()

it('persists unused entries across restart, normalized duplicates, unlinking and legacy string writes', () => {
  const f = fixture()
  const unused = f.org.createTag({ name: ' E\u0301quipe ' })
  expect(() => f.org.createTag({ name: 'éQUIPE' })).toThrow('ORGANIZATION_NAME_EXISTS')
  const review = f.org.createTag({ name: 'Review' })
  const saved = f.org.saveEnvironment({ ...metadata, tags: ['review', 'new label'] })
  expect(saved.tags).toEqual(['Review', 'new label'])
  f.org.saveEnvironment({ ...metadata, tags: [], expectedRevision: 1 })
  expect(f.org.snapshot().tags.map((t) => t.name)).toEqual(['new label', 'Review', 'Équipe'])
  f.db.close()
  const again = track(openLocalDatabase(f.file)),
    org = new EnvironmentRepository(again.sqlite).organization
  expect(org.snapshot().tags).toEqual(expect.arrayContaining([unused, review]))
  expect(org.snapshot().environments[0]?.tags).toEqual([])
})
it('renames atomically through active/trashed associations and saved filters without touching browser facts', () => {
  const f = fixture()
  f.org.saveEnvironment(metadata)
  const tag = f.org.snapshot().tags.find((t) => t.name === 'Review')!
  const savedView = f.org.createView({ name: 'Work', view })
  const unrelated = f.org.createView({
    name: 'Unrelated',
    view: { ...view, filters: { ...view.filters, tags: ['中文'] } },
  })
  f.db.sqlite.exec(
    "UPDATE environments SET lifecycle='trashed', trashed_at='2026-09-28T00:00:00.000Z' WHERE environment_id='env'",
  )
  const browser = rows(f.db.sqlite, 'environments'),
    revisions = rows(f.db.sqlite, 'environment_revisions')
  expect(f.org.updateTag({ id: tag.id, expectedRevision: 1, name: 'Renamed' })).toMatchObject({
    id: tag.id,
    name: 'Renamed',
    revision: 2,
  })
  const snapshot = f.org.snapshot()
  expect(snapshot.environments[0]).toMatchObject({
    tags: ['Renamed', '中文'],
    note: metadata.note,
    revision: 2,
  })
  expect(snapshot.views.find((v) => v.id === savedView.id)).toMatchObject({
    revision: 2,
    view: { ...view, filters: { ...view.filters, tags: ['renamed', '中文'] } },
  })
  expect(snapshot.views.find((v) => v.id === unrelated.id)).toEqual(unrelated)
  expect(rows(f.db.sqlite, 'environments')).toEqual(browser)
  expect(rows(f.db.sqlite, 'environment_revisions')).toEqual(revisions)
  expect(readFileSync(join(f.root, 'browser-data'), 'utf8')).toBe('only browser session copy')
  expect(() =>
    f.org.updateView({ id: savedView.id, name: savedView.name, view, expectedRevision: 1 }),
  ).toThrow('ORGANIZATION_CONFLICT')
  f.db.sqlite.exec("UPDATE environments SET lifecycle='active', trashed_at=NULL")
  expect(() => f.org.saveEnvironment({ ...metadata, expectedRevision: 1 })).toThrow(
    'ORGANIZATION_CONFLICT',
  )
})
it('deletes only the selected tag and association/filter conditions, keeping independent and unrelated data', () => {
  const f = fixture()
  f.org.saveEnvironment(metadata)
  const unused = f.org.createTag({ name: 'Unused' })
  const saved = f.org.createView({ name: 'Work', view })
  const tag = f.org.snapshot().tags.find((t) => t.name === 'Review')!
  const before = rows(f.db.sqlite, 'environments')
  f.org.deleteTag({ id: tag.id, expectedRevision: tag.revision })
  expect(f.org.snapshot().tags).toEqual(expect.arrayContaining([unused]))
  expect(f.org.snapshot().environments[0]).toMatchObject({
    tags: ['中文'],
    note: metadata.note,
    revision: 2,
  })
  expect(f.org.snapshot().views[0]).toMatchObject({
    id: saved.id,
    revision: 2,
    view: { ...view, filters: { ...view.filters, tags: ['中文'] } },
  })
  expect(rows(f.db.sqlite, 'environments')).toEqual(before)
  expect(readFileSync(join(f.root, 'browser-data'), 'utf8')).toBe('only browser session copy')
  expect(() => f.org.deleteTag({ id: tag.id, expectedRevision: 1 })).toThrow('NOT_FOUND')
  expect(f.org.deleteTag({ id: unused.id, expectedRevision: 1 })).toBe(true)
})
it('case-only renames update display associations and invalidate stale metadata without rewriting unchanged filter keys', () => {
  const f = fixture()
  f.org.saveEnvironment(metadata)
  const saved = f.org.createView({ name: 'Work', view })
  const tag = f.org.snapshot().tags.find((t) => t.name === 'Review')!
  f.org.updateTag({ id: tag.id, expectedRevision: 1, name: 'REVIEW' })
  expect(f.org.snapshot().environments[0]).toMatchObject({ tags: ['REVIEW', '中文'], revision: 2 })
  expect(f.org.snapshot().views[0]).toEqual(saved)
})
it('rejects collisions, duplicate submissions, stale deletes, forged owners and unsafe revisions without changes', () => {
  const f = fixture(),
    tag = f.org.createTag({ name: 'One' })
  f.org.createTag({ name: 'Two' })
  f.org.updateTag({ id: tag.id, name: 'ONE', expectedRevision: 1 })
  const before = f.org.snapshot()
  expect(() => f.org.updateTag({ id: tag.id, name: 'Two', expectedRevision: 2 })).toThrow(
    'ORGANIZATION_NAME_EXISTS',
  )
  expect(() => f.org.updateTag({ id: tag.id, name: 'Lost', expectedRevision: 1 })).toThrow(
    'ORGANIZATION_CONFLICT',
  )
  expect(() => f.org.deleteTag({ id: tag.id, expectedRevision: 1 })).toThrow(
    'ORGANIZATION_CONFLICT',
  )
  expect(() => f.org.createTag({ name: 'New', workspaceId: randomUUID() })).toThrow()
  expect(() =>
    f.org.deleteTag({ id: tag.id, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }),
  ).toThrow()
  expect(f.org.snapshot()).toEqual(before)
})
it.each(['update', 'delete'] as const)(
  'rolls back %s when updating an associated view fails mid-transaction',
  (action) => {
    const f = fixture()
    f.org.saveEnvironment(metadata)
    f.org.createView({ name: 'Work', view })
    const tag = f.org.snapshot().tags.find((t) => t.name === 'Review')!,
      before = f.org.snapshot()
    f.db.sqlite.exec(
      "CREATE TRIGGER fail_view BEFORE UPDATE ON environment_views BEGIN SELECT RAISE(ABORT, 'INJECTED_WRITE_FAILURE'); END",
    )
    expect(() =>
      action === 'update'
        ? f.org.updateTag({ id: tag.id, expectedRevision: 1, name: 'Next' })
        : f.org.deleteTag({ id: tag.id, expectedRevision: 1 }),
    ).toThrow('INJECTED_WRITE_FAILURE')
    expect(f.org.snapshot()).toEqual(before)
    f.db.sqlite.exec('DROP TRIGGER fail_view')
    expect(f.org.deleteTag({ id: tag.id, expectedRevision: 1 })).toBe(true)
  },
)
it('rolls back a failed commit, releases the lock, and does not leak legacy implicitly registered tags', () => {
  const f = fixture(),
    before = f.org.snapshot(),
    exec = f.db.sqlite.exec.bind(f.db.sqlite)
  const fault = vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
    if (sql === 'COMMIT') throw new Error('SQLITE_FULL')
    exec(sql)
  })
  expect(() => f.org.saveEnvironment(metadata)).toThrow('SQLITE_FULL')
  expect(f.org.snapshot()).toEqual(before)
  expect(() => f.org.createTag({ name: 'Failed' })).toThrow('SQLITE_FULL')
  expect(f.org.snapshot()).toEqual(before)
  fault.mockRestore()
  expect(f.org.createTag({ name: 'Works' }).revision).toBe(1)
})
it('isolates catalogs in physically independent workspaces and refuses on-disk owner tampering', () => {
  const a = fixture(),
    b = fixture(),
    tag = a.org.createTag({ name: 'Shared name' })
  const other = b.org.createTag({ name: 'Shared name' })
  expect(tag.workspaceId).not.toBe(other.workspaceId)
  expect(() => b.org.updateTag({ id: tag.id, expectedRevision: 1, name: 'Wrong owner' })).toThrow(
    'NOT_FOUND',
  )
  expect(() =>
    b.db.sqlite.prepare('UPDATE environment_tags SET workspace_id=?').run(tag.workspaceId),
  ).toThrow()
  a.org.deleteTag({ id: tag.id, expectedRevision: 1 })
  expect(b.org.snapshot().tags).toEqual([other])
})
it('backfills genuine v13 associations and filter-only tags without changing old rows/files, snapshots WAL, and migrates once', () => {
  const f = fixture(true),
    owner = new WorkspaceRepository(f.db.sqlite).current()
  f.db.sqlite
    .prepare(
      'INSERT INTO environment_organization(environment_id,tags_json,note,revision) VALUES(?,?,?,?)',
    )
    .run('env', JSON.stringify(['Review', 'Équipe', '中文']), 'retained', 7)
  f.db.sqlite
    .prepare(
      'INSERT INTO environment_views(view_id,name,name_key,view_json,revision,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      randomUUID(),
      'Work',
      'work',
      JSON.stringify({ ...view, filters: { ...view.filters, tags: ['review', 'orphan-filter'] } }),
      4,
      '2026-09-28T00:00:00.000Z',
    )
  const originals = new Map(
    ['environments', 'environment_organization', 'environment_views', 'app_settings'].map(
      (table) => [table, rows(f.db.sqlite, table)],
    ),
  )
  migrateDatabase(f.db.sqlite, f.file)
  expect(f.org.snapshot().tags.map((t) => t.name)).toEqual([
    'orphan-filter',
    'Review',
    'Équipe',
    '中文',
  ])
  for (const [table, before] of originals) expect(rows(f.db.sqlite, table)).toEqual(before)
  expect(new WorkspaceRepository(f.db.sqlite).current()).toEqual(owner)
  const snapshot = f.org.snapshot()
  migrateDatabase(f.db.sqlite, f.file)
  const backups = readdirSync(f.root).filter((f) => f.endsWith('.bak'))
  expect(backups).toHaveLength(1)
  const backup = track({
    sqlite: new DatabaseSync(join(f.root, backups[0]!)),
    close() {
      this.sqlite.close()
    },
  })
  expect(backup.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(13)
  for (const [table, before] of originals) expect(rows(backup.sqlite, table)).toEqual(before)
  f.db.close()
  const again = track(openLocalDatabase(f.file))
  expect(new EnvironmentRepository(again.sqlite).organization.snapshot()).toEqual(snapshot)
  expect(readFileSync(join(f.root, 'browser-data'), 'utf8')).toBe('only browser session copy')
})
it('upgrades legacy-valid NUL labels and filter keys without changing association bytes', () => {
  const f = fixture(true)
  const names = tagsSchema.parse(['\u0000retained', 'a\u0000b', '😀'.repeat(20)])
  const raw = JSON.stringify(names)
  f.db.sqlite
    .prepare(
      'INSERT INTO environment_organization(environment_id,tags_json,note,revision) VALUES(?,?,?,1)',
    )
    .run('env', raw, 'retained')
  f.db.sqlite
    .prepare(
      'INSERT INTO environment_views(view_id,name,name_key,view_json,revision,updated_at) VALUES(?,?,?,?,1,?)',
    )
    .run(
      randomUUID(),
      'Filter',
      'filter',
      JSON.stringify({ ...view, filters: { ...view.filters, tags: ['\u0000filter-only'] } }),
      '2026-09-28T00:00:00.000Z',
    )
  migrateDatabase(f.db.sqlite, f.file)
  expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(14)
  expect(
    f.db.sqlite.prepare('SELECT tags_json FROM environment_organization').get()?.tags_json,
  ).toBe(raw)
  expect(new Set(f.org.snapshot().tags.map((tag) => tag.name))).toEqual(
    new Set([...names, '\u0000filter-only']),
  )
  f.db.close()
  const again = track(openLocalDatabase(f.file))
  const snapshot = new EnvironmentRepository(again.sqlite).organization.snapshot()
  expect(snapshot.environments[0]?.tags).toEqual(names)
  const org = new EnvironmentRepository(again.sqlite).organization
  const original = snapshot.tags.find((tag) => tag.name === names[0])!
  expect(() => org.createTag({ name: names[0] })).toThrow('ORGANIZATION_NAME_EXISTS')
  org.updateTag({ id: original.id, expectedRevision: original.revision, name: 'renamed' })
  expect(org.snapshot().environments[0]?.tags).toEqual(['renamed', ...names.slice(1)])
  org.deleteTag({ id: original.id, expectedRevision: original.revision + 1 })
  expect(org.snapshot().environments[0]?.tags).toEqual(names.slice(1))
  expect(new Set(snapshot.tags.map((tag) => tag.name))).toEqual(
    new Set([...names, '\u0000filter-only']),
  )
})
it('aborts malformed v13 tags without discarding the raw data or advancing the version', () => {
  const f = fixture(true)
  const raw = JSON.stringify(['keep', { invalid: 'only copy' }])
  f.db.sqlite
    .prepare(
      'INSERT INTO environment_organization(environment_id,tags_json,note,revision) VALUES(?,?,?,1)',
    )
    .run('env', raw, 'keep')
  expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('DATABASE_INTEGRITY_FAILED')
  expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(13)
  expect(
    f.db.sqlite.prepare('SELECT tags_json FROM environment_organization').get()?.tags_json,
  ).toBe(raw)
  expect(
    f.db.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='environment_tags'").get(),
  ).toBeUndefined()
  expect(f.db.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
})
it('rolls back partial v14 DDL and can safely retry without overwriting the pre-upgrade backup', () => {
  const f = fixture(true),
    exec = f.db.sqlite.exec.bind(f.db.sqlite)
  const fault = vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
    if (sql.includes('CREATE TABLE environment_tags')) {
      exec(sql)
      throw new Error('INJECTED_DDL_FAILURE')
    }
    exec(sql)
  })
  expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('INJECTED_DDL_FAILURE')
  fault.mockRestore()
  const backup = join(
      f.root,
      readdirSync(f.root).find((f) => f.endsWith('.bak'))!,
    ),
    bytes = readFileSync(backup)
  expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(13)
  expect(
    f.db.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='environment_tags'").get(),
  ).toBeUndefined()
  migrateDatabase(f.db.sqlite, f.file)
  expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(14)
  expect(readFileSync(backup)).toEqual(bytes)
})
it.each(['name_key', 'reference'] as const)(
  'refuses a damaged current %s instead of repairing/deleting user data on reopen',
  (field) => {
    const f = fixture()
    f.org.saveEnvironment(metadata)
    if (field === 'name_key')
      f.db.sqlite.exec("UPDATE environment_tags SET name_key='wrong' WHERE name='Review'")
    else f.db.sqlite.exec("DELETE FROM environment_tags WHERE name='Review'")
    const before = rows(f.db.sqlite, 'environment_organization')
    f.db.close()
    expect(() => openLocalDatabase(f.file)).toThrow('DATABASE_INTEGRITY_FAILED')
    const raw = track({
      sqlite: new DatabaseSync(f.file),
      close() {
        this.sqlite.close()
      },
    })
    expect(rows(raw.sqlite, 'environment_organization')).toEqual(before)
  },
)

it('preserves legacy association bytes while presenting one display spelling for case-equivalent labels', () => {
  const f = fixture(true)
  legacyFixtureWriter(f.db.sqlite).create({
    config: environmentConfigSchema.parse({
      environmentId: 'z-env',
      name: 'Other',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
    }),
    dataDir: join(f.root, 'second'),
    platform: 'darwin',
    arch: 'arm64',
  })
  const insert = f.db.sqlite.prepare(
    'INSERT INTO environment_organization(environment_id,tags_json,note,revision) VALUES(?,?,?,1)',
  )
  insert.run('env', '["Review"]', 'first')
  insert.run('z-env', '["REVIEW"]', 'second')
  migrateDatabase(f.db.sqlite, f.file)
  expect(f.org.snapshot().tags).toHaveLength(1)
  expect(f.org.snapshot().environments.map((e) => e.tags)).toEqual([['Review'], ['Review']])
  expect(
    f.db.sqlite
      .prepare('SELECT tags_json FROM environment_organization WHERE environment_id=?')
      .get('z-env')?.tags_json,
  ).toBe('["REVIEW"]')
  const tag = f.org.snapshot().tags[0]!
  f.org.deleteTag({ id: tag.id, expectedRevision: 1 })
  expect(
    f.org.snapshot().environments.map((e) => ({ tags: e.tags, revision: e.revision })),
  ).toEqual([
    { tags: [], revision: 2 },
    { tags: [], revision: 2 },
  ])
})
it('rolls back every association when an affected revision cannot advance safely', () => {
  const f = fixture()
  f.org.saveEnvironment(metadata)
  f.org.createView({ name: 'Work', view })
  f.db.sqlite.prepare('UPDATE environment_views SET revision=?').run(Number.MAX_SAFE_INTEGER)
  const before = f.org.snapshot(),
    tag = before.tags.find((t) => t.name === 'Review')!
  expect(() => f.org.updateTag({ id: tag.id, name: 'New', expectedRevision: 1 })).toThrow()
  expect(f.org.snapshot()).toEqual(before)
})
