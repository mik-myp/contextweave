import { WorkspaceRepository } from '@contextweave/storage'
import { ArtifactRepository } from '@contextweave/storage'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-application-boundary-'))
  mkdirSync(join(root, 'environments'))
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
  const app = createApplication({
    workspaceRepository: new WorkspaceRepository(db.sqlite),
    artifactRepository: new ArtifactRepository(db.sqlite),
    repository,
    dataRoot: root,
    platform: 'darwin',
    arch: 'arm64',
    secure: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    workerPath: join(root, 'must-not-run.js'),
    forkWorker: () => {
      throw new Error('Worker must not run in boundary tests')
    },
    changed: () => {},
  })
  cleanups.push(async () => {
    await app.shutdown()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { app, root, db, repository }
}

describe('application command boundary', () => {
  it.each([
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
    'unknown:command',
    'acquireControlLease',
    'runtime:lease-control',
  ])('does not dispatch inherited or unknown command %s', async (channel) => {
    const { app } = fixture()
    expect(await app.invoke(channel)).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' })
    expect(app.channels).not.toContain(channel)
  })

  it.each([
    'workspace:current',
    'kernel:providers',
    'kernel:list',
    'environment:list',
    'environment:trash-list',
    'activity:list',
    'operation:list',
    'storage:orphans',
    'proxy:list',
    'settings:get-theme',
    'proxy:cleanup-status',
    'proxy:retry-cleanup',
  ])('rejects payloads for no-argument command %s', async (channel) => {
    const { app } = fixture()
    for (const input of [null, {}, 'unexpected', ['unexpected']])
      expect(await app.invoke(channel, input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect((await app.invoke(channel)).ok).toBe(true)
  })

  it('refuses invalid input before it can create resources or launch a worker', async () => {
    const { app, repository, root } = fixture()
    expect(await app.invoke('environment:create', { name: 'incomplete' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(await app.invoke('worker:run-smoke', { taskId: '../outside' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(await app.invoke('worker:cancel', '../outside')).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(repository.listAll()).toEqual([])
    expect(repository.listOperations()).toEqual([])
    expect(existsSync(join(root, 'worker-results'))).toBe(false)
  })

  it('blocks commands during installation and after shutdown without losing persisted data', async () => {
    const { app, repository } = fixture()
    repository.setSetting('fixture', 'keep')
    app.setUpdating(true)
    expect(await app.invoke('proxy:list')).toMatchObject({ ok: false, code: 'APP_UPDATING' })
    app.setUpdating(false)
    expect(await app.invoke('proxy:list')).toEqual({ ok: true, data: [] })
    await app.shutdown()
    expect(await app.invoke('proxy:list')).toMatchObject({ ok: false, code: 'APP_CLOSING' })
    expect(repository.getSetting('fixture')).toBe('keep')
  })
})

it('bounds history IPC pages and rejects invalid query/cursor fields without changing history', async () => {
  const { app, repository, db } = fixture()
  // These rows are page-query inputs, not 130 separate durability operations under test.
  // Keep the real database and commit all fixture rows before calling any IPC.
  db.sqlite.exec('BEGIN IMMEDIATE')
  try {
    for (let i = 0; i < 130; i++)
      repository.createOperation(`history-${i}`, 'install', 'kernel-key')
    db.sqlite.exec('COMMIT')
  } catch (error) {
    db.sqlite.exec('ROLLBACK')
    throw error
  }
  const first = await app.invoke('operation:page', { limit: 3 })
  expect(first).toMatchObject({
    ok: true,
    data: { items: expect.any(Array), previousCursor: null, nextCursor: expect.any(String) },
  })
  if (!first.ok) throw new Error('Expected page')
  expect((first.data as { items: unknown[] }).items).toHaveLength(3)
  for (const channel of ['operation:page', 'activity:page']) {
    for (const input of [undefined, null, { limit: 101 }, { sortBy: 'sql' }, { query: 'ignored?' }])
      expect(await app.invoke(channel, input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(await app.invoke(channel, { cursor: 'not-json' })).toMatchObject({
      ok: false,
      code: 'HISTORY_CURSOR_INVALID',
    })
  }
  expect(repository.listOperations()).toHaveLength(100)
})

it('routes explicit history maintenance only through strict Main-side request validation', async () => {
  const { app, repository, db } = fixture()
  expect(await app.invoke('storage:history-receipt')).toEqual({ ok: true, data: null })
  for (const [channel, input] of [
    ['storage:history-receipt', {}],
    ['storage:history-preview', { retentionDays: 90, ids: ['old'] }],
    ['storage:history-confirm', { previewId: 'old' }],
  ] as const)
    expect(await app.invoke(channel, input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  repository.createOperation('cleanup-fixture', 'install', null)
  db.sqlite.exec(
    "UPDATE operations SET started_at = '2020-01-01T00:00:00.000Z', ended_at = '2020-01-02T00:00:00.000Z', status = 'succeeded', phase = 'completed'",
  )
  const result = await app.invoke('storage:history-preview', { retentionDays: 90 })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected preview')
  const { historyCleanupPreviewSchema, historyCleanupResultSchema } =
    await import('@contextweave/contracts')
  const preview = historyCleanupPreviewSchema.parse(result.data)
  const confirmation = await app.invoke('storage:history-confirm', { previewId: preview.previewId })
  if (!confirmation.ok) throw new Error(confirmation.code)
  expect(historyCleanupResultSchema.parse(confirmation.data)).toMatchObject({
    replayed: false,
    receipt: { operations: { deleted: 1 } },
  })
  const replay = await app.invoke('storage:history-confirm', { previewId: preview.previewId })
  expect(replay).toMatchObject({ ok: true, data: { replayed: true } })
  app.setUpdating(true)
  expect(await app.invoke('storage:history-preview', { retentionDays: 90 })).toMatchObject({
    ok: false,
    code: 'APP_UPDATING',
  })
})

it('exposes a read-only bounded artifact page, not registration or deletion commands', async () => {
  const { app } = fixture()
  expect(await app.invoke('storage:artifacts-page', {})).toEqual({
    ok: true,
    data: { items: [], totals: { count: 0, bytes: 0 }, previousCursor: null, nextCursor: null },
  })
  for (const input of [
    { limit: 51 },
    { path: '/private' },
    { artifactIds: ['a'] },
    { cursor: { sql: 'SELECT' } },
  ])
    expect(await app.invoke('storage:artifacts-page', input)).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
  for (const channel of [
    'storage:artifact-register',
    'storage:artifact-delete',
    'storage:artifact-open',
  ])
    expect(await app.invoke(channel, {})).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' })
})

it('keeps screenshot policy and mutation behind strict Main-side request validation', async () => {
  const { app } = fixture()
  expect(await app.invoke('storage:artifact-budget')).toMatchObject({
    ok: true,
    data: { limitMiB: 1024, revision: 1, reserved: { count: 0, bytes: 0 } },
  })
  expect(await app.invoke('storage:artifact-budget', {})).toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
  })
  for (const value of [
    { limitMiB: 31, expectedRevision: 1 },
    { limitMiB: 64, expectedRevision: 1, releaseIds: ['foreign'] },
    { limitMiB: 64 },
  ])
    expect(await app.invoke('storage:artifact-budget-update', value)).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
  expect(
    await app.invoke('storage:artifact-budget-update', { limitMiB: 64, expectedRevision: 1 }),
  ).toMatchObject({ ok: true, data: { limitMiB: 64, revision: 2 } })
  expect(
    await app.invoke('storage:artifact-budget-update', { limitMiB: 32, expectedRevision: 1 }),
  ).toMatchObject({ ok: false, code: 'ARTIFACT_BUDGET_CONFLICT' })
})

it('serves the actual database owner without accepting a selected workspace or returning local resources', async () => {
  const { app, db, root } = fixture()
  const current = new WorkspaceRepository(db.sqlite).current()
  expect(await app.invoke('workspace:current')).toEqual({ ok: true, data: current })
  expect(await app.invoke('workspace:current', { workspaceId: 'forged' })).toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
  })
  expect(await app.invoke('workspace:switch', current.workspaceId)).toMatchObject({
    ok: false,
    code: 'UNKNOWN_COMMAND',
  })
  expect(await app.invoke('workspace:create')).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' })
  expect(JSON.stringify(await app.invoke('workspace:current'))).not.toContain(root)
  db.sqlite.exec('DROP TRIGGER local_workspace_no_delete; DELETE FROM local_workspace')
  expect(await app.invoke('workspace:current')).toMatchObject({
    ok: false,
    code: 'DATABASE_WORKSPACE_INVALID',
  })
  expect(db.sqlite.prepare('SELECT * FROM local_workspace').all()).toEqual([])
})
