import {
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openLocalDatabase,
  EnvironmentRepository,
  EnvironmentCommandRepository,
  WorkspaceRepository,
  WorkspacePaths,
  describeDatabaseMigration,
  readDatabaseMigrationPlan,
  databaseVersion,
} from './index'
import { migrateDatabase } from './migrations'
import { environmentConfigSchema } from '@contextweave/contracts'
import { randomUUID } from 'node:crypto'
import {
  openVersion4Fixture,
  openVersion8Fixture,
  openVersion9Fixture,
  openVersion10Fixture,
  openVersion11Fixture,
  openVersion12Fixture,
  openVersion13Fixture,
  legacyFixtureWriter,
} from './legacy-fixture'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function temporaryFile() {
  const root = mkdtempSync(join(tmpdir(), 'cw-migration-authority-'))
  roots.push(root)
  return { root, file: join(root, 'workspace.sqlite') }
}

describe('migration authority and final validation', () => {
  it('rolls the schema and version back when final domain validation rejects old facts', () => {
    const { root, file } = temporaryFile()
    const old = openVersion12Fixture(file)
    old.sqlite
      .prepare(
        `INSERT INTO environment_groups(group_id,name,name_key,revision,updated_at)
      VALUES(?, 'Group', 'wrong-canonical-key', 1, '2026-09-27T00:00:00.000Z')`,
      )
      .run('df7f011b-a755-48d1-8967-c604fc6b07cc')
    const original = old.sqlite.prepare('SELECT * FROM environment_groups').all()
    old.close()
    expect(() => openLocalDatabase(file).close()).toThrow('DATABASE_INTEGRITY_FAILED')
    const raw = new DatabaseSync(file, { readOnly: true })
    try {
      expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(12)
      expect(
        raw.prepare("SELECT name FROM sqlite_schema WHERE name='environment_commands'").get(),
      ).toBeUndefined()
      expect(raw.prepare('SELECT * FROM environment_groups').all()).toEqual(original)
    } finally {
      raw.close()
    }
    const snapshots = readdirSync(root).filter((name) => name.endsWith('.bak'))
    expect(snapshots).toHaveLength(1)
    const snapshot = new DatabaseSync(join(root, snapshots[0]!), { readOnly: true })
    try {
      expect(snapshot.prepare('PRAGMA user_version').get()?.user_version).toBe(12)
      expect(snapshot.prepare('SELECT * FROM environment_groups').all()).toEqual(original)
    } finally {
      snapshot.close()
    }
  })

  it('refuses a negative user_version rather than initializing it as a fresh database', () => {
    const { root, file } = temporaryFile()
    const seed = new DatabaseSync(file)
    seed.exec('PRAGMA user_version=-1')
    seed.close()
    expect(() => openLocalDatabase(file).close()).toThrow('DATABASE_VERSION_INVALID')
    const raw = new DatabaseSync(file, { readOnly: true })
    try {
      expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(-1)
      expect(raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()).toEqual([])
      expect(readdirSync(root).filter((name) => name.endsWith('.bak'))).toEqual([])
    } finally {
      raw.close()
    }
  })
})

function schema(sqlite: DatabaseSync) {
  const owner = new WorkspaceRepository(sqlite).current().workspaceId
  return sqlite
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => ({
      ...row,
      sql: typeof row.sql === 'string' ? row.sql.replaceAll(owner, '<owner>') : row.sql,
    }))
}

it('describes independent, continuous migration steps without exposing an executor or mutating a read-only database', () => {
  const fromEmpty = describeDatabaseMigration(0)
  expect(fromEmpty.state).toBe('initialize')
  expect(fromEmpty.toVersion).toBe(13)
  expect(fromEmpty.steps.map((step) => step.version)).toEqual(
    Array.from({ length: 13 }, (_, i) => i + 1),
  )
  expect(new Set(fromEmpty.steps.map((step) => step.id)).size).toBe(13)
  for (const step of fromEmpty.steps) {
    expect(Object.keys(step).sort()).toEqual(['id', 'version'])
    expect(Object.isFrozen(step)).toBe(true)
  }
  expect(Object.isFrozen(fromEmpty.steps)).toBe(true)
  expect(describeDatabaseMigration(12)).toEqual({
    fromVersion: 12,
    toVersion: 13,
    state: 'upgrade',
    steps: [{ version: 13, id: 'environment-commands' }],
  })
  for (const bad of [-1, NaN, Infinity, 0.5])
    expect(() => describeDatabaseMigration(bad)).toThrow('DATABASE_VERSION_INVALID')
  expect(() => describeDatabaseMigration(14)).toThrow('newer ContextWeave')
  const { file, root } = temporaryFile()
  openVersion12Fixture(file).close()
  const before = readFileSync(file)
  const readonly = new DatabaseSync(file, { readOnly: true })
  try {
    // SQLite itself may create WAL/SHM sidecars on the first read-only access.
    // Compare after that initial read; the plan must not execute any write or snapshot.
    expect(readonly.prepare('PRAGMA user_version').get()?.user_version).toBe(12)
    const files = readdirSync(root)
    expect(readDatabaseMigrationPlan(readonly)).toEqual(describeDatabaseMigration(12))
    expect(readonly.prepare('SELECT total_changes() AS changes').get()?.changes).toBe(0)
    expect(readdirSync(root)).toEqual(files)
  } finally {
    readonly.close()
  }
  expect(readFileSync(file)).toEqual(before)
  expect(readdirSync(root).filter((name) => name.endsWith('.bak'))).toEqual([])
})

it.each([
  [4, openVersion4Fixture],
  [8, openVersion8Fixture],
  [9, openVersion9Fixture],
  [10, openVersion10Fixture],
  [11, openVersion11Fixture],
  [12, openVersion12Fixture],
  [13, openVersion13Fixture],
] as const)(
  'preserves published v%i facts and converges to the authoritative schema on upgrade/reopen',
  (version, openFixture) => {
    const { file, root } = temporaryFile()
    const profile = join(root, 'environments', 'existing')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'only-profile-copy'), 'synthetic session bytes')
    writeFileSync(join(root, 'credentials.json'), 'synthetic opaque secret-store bytes')
    const old = openFixture(file),
      writer = legacyFixtureWriter(old.sqlite)
    let facts: { table: string; columns: string[]; rows: unknown[] }[],
      owner: string | undefined,
      receipt
    try {
      const proxy = {
        type: 'http' as const,
        host: '127.0.0.1',
        port: 8181,
        credentialRef: 'retained-reference',
      }
      writer.saveProxy('proxy', proxy)
      const config = environmentConfigSchema.parse({
        environmentId: 'existing',
        name: 'Existing',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
        proxyId: 'proxy',
        proxy,
      })
      writer.create({ config, dataDir: profile, platform: 'darwin', arch: 'arm64' })
      writer.updateConfig({ ...config, name: 'Revision two' }, 1)
      writer.setSetting('kept', { value: 'retained' })
      writer.scheduleCredentialCleanup('pending-reference')
      if (version >= 9) owner = new WorkspaceRepository(old.sqlite).current().workspaceId
      if (version === 13) {
        receipt = new EnvironmentCommandRepository(old.sqlite).reserve({
          version: 1,
          workspaceId: owner!,
          requestId: randomUUID(),
          kind: 'start',
          environmentId: 'existing',
          expectedRevision: 2,
          intentDigest: 'a'.repeat(64),
        }).receipt
      }
      facts = old.sqlite
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => {
          const table = String(row.name)
          const columns = old.sqlite
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((column) => String(column.name))
          return {
            table,
            columns,
            rows: old.sqlite.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all(),
          }
        })
    } finally {
      old.close()
    }
    const current = openVersion13Fixture(':memory:')
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const opened = openLocalDatabase(file)
        try {
          expect(readDatabaseMigrationPlan(opened.sqlite).state).toBe('current')
          const identity = new WorkspaceRepository(opened.sqlite).current()
          if (owner) expect(identity.workspaceId).toBe(owner)
          else owner = identity.workspaceId
          for (const fact of facts)
            expect(
              opened.sqlite.prepare(`SELECT ${fact.columns.join(',')} FROM ${fact.table}`).all(),
            ).toEqual(fact.rows)
          expect(schema(opened.sqlite)).toEqual(schema(current.sqlite))
          expect(opened.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
          expect(opened.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
          if (receipt)
            expect(new EnvironmentCommandRepository(opened.sqlite).get(receipt.requestId)).toEqual(
              receipt,
            )
        } finally {
          opened.close()
        }
      }
    } finally {
      current.close()
    }
    expect(readFileSync(join(profile, 'only-profile-copy'), 'utf8')).toBe('synthetic session bytes')
    expect(readFileSync(join(root, 'credentials.json'), 'utf8')).toBe(
      'synthetic opaque secret-store bytes',
    )
    const backups = readdirSync(root).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(version < databaseVersion ? 1 : 0)
    if (backups.length) {
      const backup = new DatabaseSync(join(root, backups[0]!), { readOnly: true })
      try {
        expect(readDatabaseMigrationPlan(backup).fromVersion).toBe(version)
        for (const fact of facts)
          expect(
            backup.prepare(`SELECT ${fact.columns.join(',')} FROM ${fact.table}`).all(),
          ).toEqual(fact.rows)
      } finally {
        backup.close()
      }
    }
  },
)

it.each(Array.from({ length: 13 }, (_, index) => index + 1))(
  'rolls all earlier DDL back if advancing step %i fails, then supports an explicit retry',
  (version) => {
    const sqlite = new DatabaseSync(':memory:')
    const exec = sqlite.exec.bind(sqlite)
    const fault = vi.spyOn(sqlite, 'exec').mockImplementation((sql) => {
      if (sql === `PRAGMA user_version = ${version}`)
        throw new Error('INJECTED_VERSION_WRITE_FAILURE')
      return exec(sql)
    })
    try {
      expect(() => migrateDatabase(sqlite, ':memory:')).toThrow('INJECTED_VERSION_WRITE_FAILURE')
      expect(readDatabaseMigrationPlan(sqlite).fromVersion).toBe(0)
      expect(
        sqlite.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(),
      ).toEqual([])
      expect(sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
      fault.mockRestore()
      migrateDatabase(sqlite, ':memory:')
      expect(readDatabaseMigrationPlan(sqlite).state).toBe('current')
    } finally {
      fault.mockRestore()
      sqlite.close()
    }
  },
)

it('snapshots committed WAL rather than the stale main file or an uncommitted writer, and preserves that recovery copy', () => {
  const { file, root } = temporaryFile()
  const old = openVersion12Fixture(file)
  const reader = new DatabaseSync(file)
  try {
    old.sqlite.exec('PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE)')
    old.sqlite
      .prepare(
        "INSERT INTO app_settings(setting_key,value_json,updated_at) VALUES('committed','1','2026-09-27T00:00:00.000Z')",
      )
      .run()
    const unsafeCopy = join(root, 'stale-main.sqlite')
    copyFileSync(file, unsafeCopy)
    const stale = new DatabaseSync(unsafeCopy, { readOnly: true })
    try {
      expect(
        stale.prepare("SELECT * FROM app_settings WHERE setting_key='committed'").get(),
      ).toBeUndefined()
    } finally {
      stale.close()
    }
    old.sqlite.exec(
      "BEGIN IMMEDIATE; INSERT INTO app_settings(setting_key,value_json,updated_at) VALUES('uncommitted','2','2026-09-27T00:00:00.000Z')",
    )
    expect(() => migrateDatabase(reader, file)).toThrow()
    expect(readDatabaseMigrationPlan(reader).fromVersion).toBe(12)
    const backups = readdirSync(root).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const recoveryPath = join(root, backups[0]!),
      recoveryBytes = readFileSync(recoveryPath)
    const recovery = new DatabaseSync(recoveryPath, { readOnly: true })
    try {
      expect(readDatabaseMigrationPlan(recovery).fromVersion).toBe(12)
      expect(recovery.prepare('SELECT setting_key FROM app_settings').all()).toEqual([
        { setting_key: 'committed' },
      ])
    } finally {
      recovery.close()
    }
    old.sqlite.exec('ROLLBACK')
    migrateDatabase(reader, file)
    expect(readDatabaseMigrationPlan(reader).state).toBe('current')
    expect(reader.prepare('SELECT setting_key FROM app_settings').all()).toEqual([
      { setting_key: 'committed' },
    ])
    expect(readFileSync(recoveryPath)).toEqual(recoveryBytes)
  } finally {
    reader.close()
    old.close()
  }
})

it('keeps two physical workspaces separate even with identical environment names, IDs and request IDs', () => {
  const a = temporaryFile(),
    b = temporaryFile()
  const left = openLocalDatabase(a.file),
    right = openLocalDatabase(b.file)
  try {
    const l = new EnvironmentRepository(left.sqlite),
      r = new EnvironmentRepository(right.sqlite)
    expect(l.workspaceId).not.toBe(r.workspaceId)
    const config = environmentConfigSchema.parse({
      environmentId: 'same-id',
      name: 'Same name',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
    })
    for (const [repo, root] of [
      [l, a.root],
      [r, b.root],
    ] as const)
      repo.create({
        config,
        dataDir: join(root, 'environments', 'same-id'),
        platform: 'darwin',
        arch: 'arm64',
      })
    const identity = {
      version: 1 as const,
      workspaceId: l.workspaceId,
      requestId: randomUUID(),
      kind: 'start' as const,
      environmentId: 'same-id',
      expectedRevision: 1,
      intentDigest: 'a'.repeat(64),
    }
    const receipt = l.commands.reserve(identity).receipt
    expect(r.commands.get(identity.requestId)).toBeUndefined()
    expect(() => r.commands.reserve(identity)).toThrow('WORKSPACE_MISMATCH')
    expect(
      () =>
        new EnvironmentRepository(
          right.sqlite,
          new WorkspacePaths({ workspaceId: l.workspaceId }, a.root),
        ),
    ).toThrow('WORKSPACE_MISMATCH')
    expect(
      r.commands.reserve({ ...identity, workspaceId: r.workspaceId }).receipt.workspaceId,
    ).toBe(r.workspaceId)
    expect(l.commands.get(identity.requestId)).toEqual(receipt)
    const rightOrganization = r.organization.snapshot()
    l.organization.saveEnvironment({
      environmentId: 'same-id',
      groupId: null,
      tags: [],
      note: 'left-only',
      expectedRevision: 0,
    })
    expect(r.organization.snapshot()).toEqual(rightOrganization)
    expect(l.organization.snapshot().environments[0]?.note).toBe('left-only')
    for (const db of [left, right])
      expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    left.close()
    right.close()
  }
})
