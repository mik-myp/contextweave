import { removeWorkspaceScopeForLegacyFixture, withoutWorkspaceColumn } from './legacy-fixture'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { environmentConfigSchema, type ArtifactRecord } from '@contextweave/contracts'
import { EnvironmentRepository, ArtifactRepository, openLocalDatabase } from './index'
import { databaseVersion, migrateDatabase } from './migrations'
const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) fn()
})
const at = '2026-09-27T00:00:00.000Z'
function fixture(file = ':memory:') {
  const db = openLocalDatabase(file)
  cleanup.push(() => {
    if (db.sqlite.isOpen) db.close()
  })
  const environments = new EnvironmentRepository(db.sqlite)
  if (!environments.get('env'))
    environments.create({
      config: environmentConfigSchema.parse({
        environmentId: 'env',
        name: 'Owned environment',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
      }),
      dataDir: '/fixture/profile',
      platform: 'darwin',
      arch: 'arm64',
    })
  return { db, repo: new ArtifactRepository(db.sqlite), environments }
}
function record(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const identity = {
    dev: '1',
    ino: '18446744073709551615',
    birthtimeNs: '1790467200000000000',
  }
  return {
    artifactId: randomUUID(),
    environmentId: 'env',
    taskId: 'repeatable',
    allocationName: `run-${randomUUID().slice(0, 6)}`,
    bytes: 8,
    sha256: 'a'.repeat(64),
    completedAt: at,
    ownership: {
      version: 1,
      root: identity,
      directory: identity,
      file: identity,
    },
    ...overrides,
  }
}
function fileFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-artifacts-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'db.sqlite')
  return { root, file, ...fixture(file) }
}
// Inputs are established before any injected completion fault. Every production
// completion now requires a committed, bound reservation rather than free insertion.
const prepared = new WeakMap<ArtifactRepository, Set<string>>()
function prepare(repo: ArtifactRepository, input: ArtifactRecord) {
  let ids = prepared.get(repo)
  if (!ids) {
    ids = new Set()
    prepared.set(repo, ids)
  }
  if (ids.has(input.artifactId)) return
  repo.reserve({
    artifactId: input.artifactId,
    environmentId: input.environmentId,
    taskId: input.taskId,
    reservedAt: at,
  })
  repo.bindAllocation({
    artifactId: input.artifactId,
    allocationName: input.allocationName,
    ownership: input.ownership,
  })
  ids.add(input.artifactId)
}
function register(repo: ArtifactRepository, input: ArtifactRecord) {
  prepare(repo, input)
  repo.registerArtifact(input)
}
describe('registered screenshot repository', () => {
  it('keeps an empty bounded page and only public metadata, never ownership/path fields', () => {
    const { repo } = fixture()
    expect(repo.pageArtifacts({})).toEqual({
      items: [],
      nextCursor: null,
      previousCursor: null,
      totals: { count: 0, bytes: 0 },
    })
    const input = record()
    register(repo, input)
    const page = repo.pageArtifacts({})
    expect(page.totals).toEqual({ count: 1, bytes: 8 })
    expect(page.items[0]).toMatchObject({
      artifactId: input.artifactId,
      environmentName: 'Owned environment',
    })
    for (const forbidden of ['ownership', 'allocationName', 'screenshotPath', 'dataDir'])
      expect(page.items[0]).not.toHaveProperty(forbidden)
  })
  it('reopens persisted records, permits task-ID reuse and idempotent exact registration, but never overwrites', () => {
    const { repo, db, file } = fileFixture()
    const first = record()
    register(repo, first)
    register(repo, first)
    register(repo, record())
    expect(() => register(repo, { ...first, bytes: 9 })).toThrow('ARTIFACT_ID_CONFLICT')
    expect(() => register(repo, record({ allocationName: first.allocationName }))).toThrow()
    db.close()
    const reopened = fixture(file)
    expect(reopened.repo.pageArtifacts({}).totals).toEqual({
      count: 2,
      bytes: 16,
    })
    expect(reopened.repo.pageArtifacts({}).items.map((item) => item.taskId)).toEqual([
      'repeatable',
      'repeatable',
    ])
  })
  it('uses keyset ordering without duplicates on timestamp ties or later insertions, and returns previous pages', () => {
    const { repo } = fixture()
    for (let i = 1; i <= 65; i++)
      register(
        repo,
        record({
          artifactId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          allocationName: `run-${String(i).padStart(6, '0')}`,
        }),
      )
    const first = repo.pageArtifacts({ limit: 20 })
    register(repo, record({ completedAt: '2026-09-27T01:00:00.000Z' }))
    const second = repo.pageArtifacts({ limit: 20, cursor: first.nextCursor })
    const third = repo.pageArtifacts({ limit: 20, cursor: second.nextCursor })
    const last = repo.pageArtifacts({ limit: 20, cursor: third.nextCursor })
    const ids = [...first.items, ...second.items, ...third.items, ...last.items].map(
      (i) => i.artifactId,
    )
    expect(new Set(ids).size).toBe(65)
    expect(ids).toHaveLength(65)
    expect(last.nextCursor).toBeNull()
    expect(last.items).toHaveLength(5)
    expect(repo.pageArtifacts({ limit: 20, cursor: second.previousCursor }).items).toEqual(
      first.items,
    )
    expect(last.totals).toEqual({ count: 66, bytes: 528 })
    expect(() => repo.pageArtifacts({ limit: 51 })).toThrow()
  })
  it('survives history removal and environment trash, with RESTRICT physical foreign keys', () => {
    const { repo, db } = fixture()
    register(repo, record())
    db.sqlite.exec(
      "DELETE FROM operations; DELETE FROM runtime_sessions; UPDATE environments SET lifecycle='trashed', trashed_at='2026-09-27' WHERE environment_id='env'",
    )
    expect(repo.pageArtifacts({}).totals.count).toBe(1)
    expect(() => db.sqlite.exec("DELETE FROM environments WHERE environment_id='env'")).toThrow()
    expect(() => register(repo, record({ environmentId: 'missing' }))).toThrow()
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it.each([
    'bytes=0',
    'bytes=33554433',
    'bytes=1.5',
    "sha256='invalid'",
    "allocation_name='../outside'",
    "ownership_json='[1]'",
    "completed_at='yesterday'",
  ])('constrains direct SQL mutation: %s', (mutation) => {
    const { repo, db } = fixture()
    register(repo, record())
    expect(() => db.sqlite.exec(`UPDATE screenshot_artifacts SET ${mutation}`)).toThrow()
    expect(repo.pageArtifacts({}).totals.count).toBe(1)
  })
  it('fails closed for corrupt persisted ownership metadata rather than returning false proof', () => {
    const { repo, db } = fixture()
    register(repo, record())
    db.sqlite.exec("UPDATE screenshot_artifacts SET ownership_json='{}'")
    expect(() => repo.pageArtifacts({})).toThrow()
  })
  it('never reports success inside a caller transaction', () => {
    const { repo, db } = fixture()
    const input = record()
    prepare(repo, input)
    db.sqlite.exec('BEGIN')
    expect(() => register(repo, input)).toThrow()
    db.sqlite.exec('ROLLBACK')
    expect(repo.pageArtifacts({}).totals.count).toBe(0)
  })
  it('rolls back failed COMMIT and permits an explicit later attempt', () => {
    const { repo, db } = fixture()
    const input = record()
    prepare(repo, input)
    const exec = db.sqlite.exec.bind(db.sqlite)
    vi.spyOn(db.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT') throw new Error('disk full')
      return exec(sql)
    })
    expect(() => register(repo, input)).toThrow('disk full')
    vi.restoreAllMocks()
    expect(repo.pageArtifacts({}).totals.count).toBe(0)
    register(repo, input)
    expect(repo.pageArtifacts({}).totals.count).toBe(1)
  })
  it.each([false, true])(
    'closes an uncertain connection and reconciles durable state on reopen (commit actually happened: %s)',
    (committed) => {
      const { repo, db, file } = fileFixture()
      const input = record()
      prepare(repo, input)
      const exec = db.sqlite.exec.bind(db.sqlite)
      vi.spyOn(db.sqlite, 'exec').mockImplementation((sql) => {
        if (sql === 'COMMIT') {
          if (committed) exec(sql)
          throw new Error('lost completion')
        }
        if (sql === 'ROLLBACK') throw new Error('rollback unavailable')
        return exec(sql)
      })
      expect(() => register(repo, input)).toThrow('lost completion')
      expect(db.sqlite.isOpen).toBe(false)
      vi.restoreAllMocks()
      expect(fixture(file).repo.pageArtifacts({}).totals.count).toBe(committed ? 1 : 0)
    },
  )
  it('does not insert while a separate connection owns the write lock', () => {
    const { repo, file } = fileFixture()
    const input = record()
    prepare(repo, input)
    const writer = new DatabaseSync(file)
    try {
      writer.exec('BEGIN IMMEDIATE')
      expect(() => register(repo, input)).toThrow()
      writer.exec('ROLLBACK')
      expect(repo.pageArtifacts({}).totals.count).toBe(0)
    } finally {
      writer.close()
    }
  })
})
describe('schema v7 migration', () => {
  function v6() {
    const f = fileFixture()
    removeWorkspaceScopeForLegacyFixture(f.db.sqlite)
    f.db.sqlite.exec(
      " DROP TABLE screenshot_reservations; DROP TABLE screenshot_budget; DROP TABLE screenshot_artifacts; PRAGMA user_version=6; INSERT INTO app_settings VALUES ('artifact-fixture', '{\"retained\":true}', '2026-09-27')",
    )
    return f
  }
  it('takes a consistent v6 backup, adds only the constrained table/indexes, and reopens without repeated migration', () => {
    const f = v6()
    const before = f.db.sqlite
      .prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
    migrateDatabase(f.db.sqlite, f.file)
    expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion)
    expect(
      withoutWorkspaceColumn(f.db.sqlite
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT IN ('screenshot_artifacts','screenshot_budget','screenshot_reservations','local_workspace','environment_groups','environment_organization','environment_views','batch_tasks','batch_items','environment_commands') ORDER BY name",
        )
        .all()),
    ).toEqual(before)
    const backupName = readdirSync(f.root).find((name) => name.endsWith('.bak'))!
    const backup = new DatabaseSync(join(f.root, backupName))
    try {
      expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(6)
      expect(
        backup
          .prepare("SELECT value_json FROM app_settings WHERE setting_key='artifact-fixture'")
          .get()?.value_json,
      ).toBe('{"retained":true}')
      expect(
        backup.prepare("SELECT 1 FROM sqlite_master WHERE name='screenshot_artifacts'").get(),
      ).toBeUndefined()
    } finally {
      backup.close()
    }
    f.db.close()
    fixture(f.file)
    expect(readdirSync(f.root).filter((name) => name.endsWith('.bak'))).toHaveLength(1)
  })
  it.each(['DDL', 'COMMIT'])(
    'rolls back v7 %s failure without changing v6, then migrates cleanly',
    (phase) => {
      const f = v6()
      const exec = f.db.sqlite.exec.bind(f.db.sqlite)
      vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
        if (phase === 'DDL' && sql.includes('CREATE TABLE screenshot_artifacts')) {
          exec(sql)
          throw new Error('injected DDL')
        }
        if (phase === 'COMMIT' && sql === 'COMMIT') throw new Error('injected COMMIT')
        return exec(sql)
      })
      expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('injected')
      vi.restoreAllMocks()
      expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(6)
      expect(
        f.db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='screenshot_artifacts'").get(),
      ).toBeUndefined()
      expect(f.db.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
      migrateDatabase(f.db.sqlite, f.file)
      expect(f.repo.pageArtifacts({}).totals.count).toBe(0)
    },
  )
  it('rejects a future schema without downgrading or overwriting it', () => {
    const f = fileFixture()
    f.db.sqlite.exec(`PRAGMA user_version=${databaseVersion + 1}`)
    f.db.close()
    expect(() => openLocalDatabase(f.file)).toThrow('requires a newer')
    const raw = new DatabaseSync(f.file)
    try {
      expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(databaseVersion + 1)
    } finally {
      raw.close()
    }
  })
})

it('isolates a failed artifact connection from the environment connection on the same database file', () => {
  const f = fileFixture()
  const artifactDb = openLocalDatabase(f.file)
  const artifacts = new ArtifactRepository(artifactDb.sqlite)
  const input = record()
  prepare(artifacts, input)
  const exec = artifactDb.sqlite.exec.bind(artifactDb.sqlite)
  vi.spyOn(artifactDb.sqlite, 'exec').mockImplementation((sql) => {
    if (sql === 'COMMIT' || sql === 'ROLLBACK') throw new Error('uncertain registration')
    return exec(sql)
  })
  expect(() => artifacts.registerArtifact(input)).toThrow('uncertain registration')
  expect(artifactDb.sqlite.isOpen).toBe(false)
  expect(f.db.sqlite.isOpen).toBe(true)
  f.environments.updateStatus('env', 'stopped')
  expect(f.environments.get('env')?.status).toBe('stopped')
  expect(f.repo.pageArtifacts({}).totals.count).toBe(0)
})
