import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { environmentConfigSchema, type BatchPreview } from '@contextweave/contracts'
import { openLocalDatabase, EnvironmentRepository, WorkspaceRepository } from './index'
import { openVersion11Fixture, legacyFixtureWriter } from './legacy-fixture'
import { migrateDatabase, databaseVersion } from './migrations'
const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) fn()
})
function folder() {
  const d = mkdtempSync(join(tmpdir(), 'cw-batches-'))
  cleanup.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}
function track<T extends { sqlite: DatabaseSync; close: () => void }>(db: T): T {
  cleanup.push(() => {
    if (db.sqlite.isOpen) db.close()
  })
  return db
}
function fixture() {
  const d = folder(),
    file = join(d, 'workspace.sqlite'),
    db = track(openLocalDatabase(file)),
    repo = new EnvironmentRepository(db.sqlite)
  return { d, file, db, repo, batches: repo.batches }
}
function preview(workspaceId: string, overrides: Partial<BatchPreview> = {}): BatchPreview {
  return {
    id: randomUUID(),
    workspaceId,
    action: 'start',
    sourceTaskId: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    targets: ['a', 'b'].map((environmentId) => ({
      environmentId,
      name: environmentId,
      revision: 1,
      reason: null,
    })),
    ...overrides,
  }
}
const tableSnapshot = (sqlite: DatabaseSync, table: string) =>
  sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
describe('durable backend batch facts', () => {
  it('persists frozen targets, one receipt per confirmation, independent paged task history and ownership', () => {
    const { db, file, repo, batches } = fixture(),
      input = preview(repo.workspaceId)
    const first = batches.create(input, '2026-01-01T00:00:00.000Z')
    input.targets[0]!.name = 'later change'
    expect(batches.create(input).id).toBe(first.id)
    expect(batches.get(first.id)?.items[0]?.name).toBe('a')
    const second = batches.create(preview(repo.workspaceId), '2026-01-02T00:00:00.000Z')
    const page = batches.page({ limit: 1 })
    expect(page.items.map((item) => item.id)).toEqual([second.id])
    expect(page.nextCursor).toBe(second.id)
    expect(
      batches.page({ limit: 1, beforeId: page.nextCursor }).items.map((item) => item.id),
    ).toEqual([first.id])
    expect(() => batches.page({ beforeId: randomUUID() })).toThrow('BATCH_CURSOR_STALE')
    expect(() => batches.create(preview(randomUUID()))).toThrow('WORKSPACE_MISMATCH')
    expect(() =>
      db.sqlite.prepare('UPDATE batch_items SET workspace_id=?').run(randomUUID()),
    ).toThrow()
    db.close()
    const reopened = track(openLocalDatabase(file))
    expect(new EnvironmentRepository(reopened.sqlite).batches.get(first.id)?.items[0]?.name).toBe(
      'a',
    )
  })
  it('executes confirmations in durable FIFO order even when timestamps tie and UUID order differs', () => {
    const { repo, batches } = fixture(),
      time = '2026-01-01T00:00:00.000Z'
    const first = batches.create(
      preview(repo.workspaceId, { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
      time,
    )
    batches.create(preview(repo.workspaceId, { id: '00000000-0000-4000-8000-000000000000' }), time)
    expect(batches.nextQueued()?.id).toBe(first.id)
  })
  it('cancels only queued work and retains in-flight success, with no successful rollback', () => {
    const { repo, batches } = fixture(),
      task = batches.create(preview(repo.workspaceId))
    batches.startItem(task.id, 0)
    const cancelling = batches.cancel(task.id)
    expect(cancelling.status).toBe('cancelling')
    expect(cancelling.items.map((item) => item.status)).toEqual(['running', 'cancelled'])
    expect(() => batches.startItem(task.id, 1)).toThrow('BATCH_STATE_CONFLICT')
    const ended = batches.finishItem(task.id, 0, 'succeeded', null)
    expect(ended.status).toBe('cancelled')
    expect(ended.counts).toMatchObject({
      succeeded: 1,
      cancelled: 1,
      running: 0,
    })
    expect(batches.cancel(task.id)).toEqual(ended)
  })
  it('recovers unknown in-flight effects without replay and preserves explicit failures', () => {
    const { repo, batches } = fixture()
    const p = preview(repo.workspaceId)
    p.targets.push({
      environmentId: 'c',
      name: 'c',
      revision: 1,
      reason: null,
    })
    const task = batches.create(p)
    batches.startItem(task.id, 0)
    batches.finishItem(task.id, 0, 'failed', 'COMMAND_FAILED')
    batches.startItem(task.id, 1)
    expect(batches.recoverInterrupted()).toBe(1)
    expect(batches.get(task.id)).toMatchObject({
      status: 'interrupted',
      counts: { failed: 1, unknown: 1, skipped: 1, queued: 0, running: 0 },
    })
    expect(batches.recoverInterrupted()).toBe(0)
    expect(batches.nextQueued()).toBeUndefined()
  })
  it('writes complete task and transitions atomically under injected storage errors', () => {
    const { db, repo, batches } = fixture()
    db.sqlite.exec(
      "CREATE TEMP TRIGGER fail_second BEFORE INSERT ON batch_items WHEN NEW.ordinal=1 BEGIN SELECT RAISE(ABORT,'injected'); END",
    )
    expect(() => batches.create(preview(repo.workspaceId))).toThrow('injected')
    expect(batches.page({}).items).toEqual([])
    db.sqlite.exec('DROP TRIGGER fail_second')
    const task = batches.create(preview(repo.workspaceId))
    db.sqlite.exec(
      "CREATE TEMP TRIGGER fail_transition BEFORE UPDATE ON batch_items BEGIN SELECT RAISE(ABORT,'injected'); END",
    )
    expect(() => batches.startItem(task.id, 0)).toThrow('injected')
    expect(batches.get(task.id)).toEqual(task)
  })
  it('retains all published v11 DDL/rows, identity, profile marker, and a consistent upgrade snapshot', () => {
    const d = folder(),
      file = join(d, 'workspace.sqlite'),
      old = track(openVersion11Fixture(file)),
      writer = legacyFixtureWriter(old.sqlite)
    const profile = join(d, 'profile-marker')
    writeFileSync(profile, 'only-copy')
    writer.create({
      config: environmentConfigSchema.parse({
        environmentId: 'old',
        name: 'Old',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
      }),
      dataDir: d,
      platform: 'darwin',
      arch: 'arm64',
    })
    const ddl = old.sqlite
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
    const tables = old.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name))
    const rows = new Map(tables.map((name) => [name, tableSnapshot(old.sqlite, name)])),
      owner = new WorkspaceRepository(old.sqlite).current()
    old.close()
    const db = track(openLocalDatabase(file))
    expect(new WorkspaceRepository(db.sqlite).current()).toEqual(owner)
    for (const entry of ddl)
      expect(
        db.sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(String(entry.name))
          ?.sql,
      ).toBe(entry.sql)
    for (const table of tables) expect(tableSnapshot(db.sqlite, table)).toEqual(rows.get(table))
    expect(readFileSync(profile, 'utf8')).toBe('only-copy')
    const backups = readdirSync(d).filter((name) => name.includes(`.before-v${databaseVersion}-`))
    expect(backups).toHaveLength(1)
    const backup = track({
      sqlite: new DatabaseSync(join(d, backups[0]!)),
      close() {
        this.sqlite.close()
      },
    })
    expect(backup.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(11)
    for (const table of tables) expect(tableSnapshot(backup.sqlite, table)).toEqual(rows.get(table))
    db.close()
    track(openLocalDatabase(file))
    expect(readdirSync(d).filter((name) => name.includes('.bak'))).toHaveLength(1)
  })
  it('rolls back partial v12 DDL to the actual v11 schema', () => {
    const d = folder(),
      file = join(d, 'old.sqlite'),
      db = track(openVersion11Fixture(file)),
      original = db.sqlite.exec.bind(db.sqlite)
    vi.spyOn(db.sqlite, 'exec').mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE batch_tasks')) {
        original('CREATE TABLE partial_batch(id INTEGER)')
        throw new Error('injected')
      }
      return original(sql)
    })
    expect(() => migrateDatabase(db.sqlite, file)).toThrow('injected')
    expect(db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(11)
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('partial_batch','batch_tasks','batch_items')",
        )
        .all(),
    ).toEqual([])
    expect(db.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })
})
