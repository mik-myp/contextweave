import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  environmentConfigSchema,
  maxArtifactBytes,
  type ArtifactRecord,
} from '@contextweave/contracts'
import { ArtifactRepository, EnvironmentRepository, openLocalDatabase } from './index'
import { migrateDatabase } from './migrations'
const at = '2026-09-27T00:00:00.000Z'
const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0).reverse()) clean()
})
function fixture(file?: string) {
  const root = file ? undefined : mkdtempSync(join(tmpdir(), 'cw-artifact-budget-'))
  if (root) cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  file ??= join(root!, 'data.sqlite')
  const db = openLocalDatabase(file)
  cleanups.push(() => {
    if (db.sqlite.isOpen) db.close()
  })
  const env = new EnvironmentRepository(db.sqlite)
  if (!env.get('env'))
    env.create({
      config: environmentConfigSchema.parse({
        environmentId: 'env',
        name: 'Budget fixture',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
      }),
      dataDir: '/fixture/profile',
      platform: 'darwin',
      arch: 'arm64',
    })
  const repo = new ArtifactRepository(db.sqlite)
  return { root, file, db, env, repo }
}
function input(): ArtifactRecord {
  const identity = { dev: '1', ino: '2', birthtimeNs: '1790467200000000000' }
  return {
    artifactId: randomUUID(),
    environmentId: 'env',
    taskId: 'reusable',
    allocationName: `run-${randomUUID().slice(0, 6)}`,
    bytes: 8,
    sha256: 'a'.repeat(64),
    completedAt: at,
    ownership: { version: 1, root: identity, directory: identity, file: identity },
  }
}
function reserve(repo: ArtifactRepository, record: ArtifactRecord, bind = true) {
  repo.reserve({
    artifactId: record.artifactId,
    environmentId: record.environmentId,
    taskId: record.taskId,
    reservedAt: at,
  })
  if (bind)
    repo.bindAllocation({
      artifactId: record.artifactId,
      allocationName: record.allocationName,
      ownership: record.ownership,
    })
}
function limit(repo: ArtifactRepository, limitMiB: number) {
  return repo.updateBudget({ limitMiB, expectedRevision: repo.budget().revision })
}

describe('persistent screenshot budgets', () => {
  it('reserves the last maximum-size allocation across two real connections without over-issuing', () => {
    const one = fixture(),
      two = fixture(one.file)
    expect(one.repo.budget()).toMatchObject({
      limitMiB: 1024,
      revision: 1,
      reserved: { count: 0, bytes: 0 },
    })
    limit(one.repo, 32)
    reserve(one.repo, input())
    expect(() => reserve(two.repo, input())).toThrow('ARTIFACT_BUDGET_EXCEEDED')
    expect(two.repo.budget()).toMatchObject({
      reserved: { count: 1, bytes: maxArtifactBytes },
      availableBytes: 0,
    })
    one.db.close()
    two.db.close()
    expect(fixture(one.file).repo.budget().reserved.count).toBe(1)
  })
  it('holds the write exclusion through the actual last-slot insert, not just the earlier capacity read', () => {
    const one = fixture(),
      two = fixture(one.file),
      first = input(),
      competing = input()
    limit(one.repo, 32)
    const prepare = one.db.sqlite.prepare.bind(one.db.sqlite)
    let observed = false
    vi.spyOn(one.db.sqlite, 'prepare').mockImplementation((sql) => {
      if (sql.includes('INSERT INTO screenshot_reservations')) {
        observed = true
        expect(() => reserve(two.repo, competing, false)).toThrow()
      }
      return prepare(sql)
    })
    reserve(one.repo, first, false)
    expect(observed).toBe(true)
    expect(two.repo.budget().reserved.count).toBe(1)
    expect(() => reserve(two.repo, competing, false)).toThrow('ARTIFACT_BUDGET_EXCEEDED')
  })
  it('retains outstanding intent on restart and atomically replaces a bound maximum reservation with actual bytes', () => {
    const f = fixture(),
      record = input()
    limit(f.repo, 32)
    reserve(f.repo, record)
    f.db.close()
    const next = fixture(f.file)
    expect(next.repo.budget().availableBytes).toBe(0)
    next.repo.registerArtifact(record)
    expect(next.repo.budget()).toMatchObject({
      registered: { count: 1, bytes: 8 },
      reserved: { count: 0, bytes: 0 },
      availableBytes: maxArtifactBytes - 8,
    })
    next.repo.registerArtifact(record)
    expect(() => reserve(next.repo, input())).toThrow('ARTIFACT_BUDGET_EXCEEDED')
    expect(() => next.repo.releaseReservation(record.artifactId)).toThrow(
      'ARTIFACT_ALREADY_REGISTERED',
    )
    limit(next.repo, 64)
    reserve(next.repo, input())
  })
  it('cannot complete without bound original ownership or change a binding, environment, task or maximum bytes', () => {
    const f = fixture(),
      record = input()
    expect(() => f.repo.registerArtifact(record)).toThrow('ARTIFACT_RESERVATION_MISSING')
    reserve(f.repo, record, false)
    expect(() => f.repo.registerArtifact(record)).toThrow('ARTIFACT_RESERVATION_INVALID')
    const allocation = {
      artifactId: record.artifactId,
      allocationName: record.allocationName,
      ownership: record.ownership,
    }
    f.repo.bindAllocation(allocation)
    f.repo.bindAllocation(allocation)
    expect(() => f.repo.bindAllocation({ ...allocation, allocationName: 'run-abcdef' })).toThrow(
      'ARTIFACT_RESERVATION_CONFLICT',
    )
    for (const changed of [
      { ...record, taskId: 'other' },
      { ...record, environmentId: 'other' },
      {
        ...record,
        ownership: { ...record.ownership, file: { ...record.ownership.file, ino: '3' } },
      },
    ])
      expect(() => f.repo.registerArtifact(changed)).toThrow('ARTIFACT_RESERVATION_CONFLICT')
    expect(() => f.repo.registerArtifact({ ...record, bytes: maxArtifactBytes + 1 })).toThrow()
    expect(f.repo.budget().reserved.count).toBe(1)
    expect(f.repo.budget().registered.count).toBe(0)
  })
  it('uses revision-controlled limits without deleting existing work when the budget shrinks', () => {
    const f = fixture(),
      one = input(),
      two = input()
    reserve(f.repo, one)
    reserve(f.repo, two)
    const policy = limit(f.repo, 32)
    expect(policy).toMatchObject({
      revision: 2,
      reserved: { count: 2, bytes: 2 * maxArtifactBytes },
      availableBytes: 0,
    })
    expect(() => f.repo.updateBudget({ limitMiB: 64, expectedRevision: 1 })).toThrow(
      'ARTIFACT_BUDGET_CONFLICT',
    )
    f.repo.registerArtifact(one)
    f.repo.releaseReservation(two.artifactId)
    f.repo.releaseReservation(two.artifactId)
    expect(f.repo.budget().registered.count).toBe(1)
    expect(f.repo.budget().reserved.count).toBe(0)
    f.env.updateStatus('env', 'stopped')
    expect(f.env.get('env')?.status).toBe('stopped')
  })
  it.each(['reserve', 'bind', 'complete', 'release', 'policy'] as const)(
    'keeps durable results after a lost %s COMMIT response without double-spending',
    (phase) => {
      const f = fixture(),
        record = input()
      if (phase !== 'reserve' && phase !== 'policy') reserve(f.repo, record, phase !== 'bind')
      const exec = f.db.sqlite.exec.bind(f.db.sqlite)
      vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
        if (sql === 'COMMIT') {
          exec(sql)
          throw new Error('lost committed response')
        }
        return exec(sql)
      })
      const action = {
        reserve: () => reserve(f.repo, record, false),
        bind: () =>
          f.repo.bindAllocation({
            artifactId: record.artifactId,
            allocationName: record.allocationName,
            ownership: record.ownership,
          }),
        complete: () => f.repo.registerArtifact(record),
        release: () => f.repo.releaseReservation(record.artifactId),
        policy: () => limit(f.repo, 64),
      }[phase]
      expect(action).toThrow('lost committed response')
      expect(f.db.sqlite.isOpen).toBe(false)
      vi.restoreAllMocks()
      const next = fixture(f.file)
      expect(next.repo.budget().reserved.count).toBe(['reserve', 'bind'].includes(phase) ? 1 : 0)
      expect(next.repo.budget().registered.count).toBe(phase === 'complete' ? 1 : 0)
      expect(next.repo.budget().limitMiB).toBe(phase === 'policy' ? 64 : 1024)
      if (phase === 'complete') {
        next.repo.registerArtifact(record)
        expect(next.repo.budget().registered.count).toBe(1)
      }
    },
  )
  it('rolls back completion without releasing its charge, and isolates an unusable artifact connection', () => {
    const f = fixture(),
      other = fixture(f.file),
      record = input()
    reserve(other.repo, record)
    const exec = other.db.sqlite.exec.bind(other.db.sqlite)
    vi.spyOn(other.db.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT' || sql === 'ROLLBACK') throw new Error('disk failure')
      return exec(sql)
    })
    expect(() => other.repo.registerArtifact(record)).toThrow('disk failure')
    expect(other.db.sqlite.isOpen).toBe(false)
    expect(f.repo.budget()).toMatchObject({
      registered: { count: 0, bytes: 0 },
      reserved: { count: 1, bytes: maxArtifactBytes },
    })
    f.env.updateStatus('env', 'stopped')
    expect(f.env.get('env')?.status).toBe('stopped')
  })
  it('requires actual write-lock acquisition and strict SQL limits, never a caller transaction', () => {
    const f = fixture(),
      record = input()
    f.db.sqlite.exec('BEGIN IMMEDIATE')
    expect(() => reserve(f.repo, record)).toThrow()
    f.db.sqlite.exec('ROLLBACK')
    for (const sql of [
      'UPDATE screenshot_budget SET limit_mib=31',
      'UPDATE screenshot_budget SET revision=0',
      'INSERT INTO screenshot_budget VALUES(2,32,1)',
    ])
      expect(() => f.db.sqlite.exec(sql)).toThrow()
    const second = fixture(f.file)
    f.db.sqlite.exec('BEGIN IMMEDIATE')
    expect(() => reserve(second.repo, record)).toThrow()
    f.db.sqlite.exec('ROLLBACK')
    expect(second.repo.budget().reserved.count).toBe(0)
  })
})

describe('additive v7 to v8 migration', () => {
  function version7() {
    const f = fixture(),
      record = input()
    reserve(f.repo, record)
    f.repo.registerArtifact(record)
    f.db.sqlite.exec(
      'BEGIN IMMEDIATE; DROP TABLE screenshot_reservations; DROP TABLE screenshot_budget; PRAGMA user_version=7; COMMIT',
    )
    return { ...f, record }
  }
  it('preserves registered records and committed WAL in the pre-upgrade snapshot, and is idempotent', () => {
    const f = version7()
    migrateDatabase(f.db.sqlite, f.file)
    expect(f.repo.pageArtifacts({}).items[0]?.artifactId).toBe(f.record.artifactId)
    expect(f.repo.budget()).toMatchObject({
      limitMiB: 1024,
      registered: { count: 1, bytes: 8 },
      reserved: { count: 0, bytes: 0 },
    })
    const names = readdirSync(f.root!).filter((name) => name.includes('.before-v8-'))
    expect(names).toHaveLength(1)
    const before = new DatabaseSync(join(f.root!, names[0]!))
    try {
      expect(before.prepare('PRAGMA user_version').get()?.user_version).toBe(7)
      expect(
        before.prepare('SELECT artifact_id FROM screenshot_artifacts').get()?.artifact_id,
      ).toBe(f.record.artifactId)
      expect(
        before.prepare("SELECT 1 FROM sqlite_master WHERE name='screenshot_reservations'").get(),
      ).toBeUndefined()
    } finally {
      before.close()
    }
    f.db.close()
    fixture(f.file)
    expect(readdirSync(f.root!).filter((name) => name.endsWith('.bak'))).toHaveLength(1)
  })
  it.each(['DDL', 'COMMIT'] as const)(
    'rolls back %s failure preserving the complete v7 baseline',
    (phase) => {
      const f = version7(),
        exec = f.db.sqlite.exec.bind(f.db.sqlite)
      vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
        if (phase === 'DDL' && sql.includes('CREATE TABLE screenshot_budget')) {
          exec(sql)
          throw new Error('injected migration')
        }
        if (phase === 'COMMIT' && sql === 'COMMIT') throw new Error('injected migration')
        return exec(sql)
      })
      expect(() => migrateDatabase(f.db.sqlite, f.file)).toThrow('injected migration')
      vi.restoreAllMocks()
      expect(f.db.sqlite.prepare('PRAGMA user_version').get()?.user_version).toBe(7)
      expect(f.repo.pageArtifacts({}).totals).toEqual({ count: 1, bytes: 8 })
      expect(
        f.db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='screenshot_budget'").get(),
      ).toBeUndefined()
      migrateDatabase(f.db.sqlite, f.file)
      expect(f.repo.budget().registered.bytes).toBe(8)
    },
  )
})
