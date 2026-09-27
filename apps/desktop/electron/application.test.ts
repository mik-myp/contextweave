import { randomUUID } from 'node:crypto'
import { symlinkSync, readdirSync } from 'node:fs'
import { environmentConfigSchema, type DataChanged } from '@contextweave/contracts'
import { scopedCommands } from '../test-support/workspace'
import { WorkspaceRepository } from '@contextweave/storage'
import { ArtifactRepository } from '@contextweave/storage'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const events: DataChanged[] = []
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
    changed: (event) => events.push(event),
  })
  cleanups.push(async () => {
    await app.shutdown()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { app: scopedCommands(app, repository.context), rawApp: app, root, db, repository, events }
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
    'organization:list',
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
  db.sqlite.exec(
    'PRAGMA foreign_keys=OFF; DROP TRIGGER local_workspace_no_delete; DELETE FROM local_workspace; PRAGMA foreign_keys=ON',
  )
  expect(await app.invoke('workspace:current')).toMatchObject({
    ok: false,
    code: 'DATABASE_WORKSPACE_INVALID',
  })
  expect(db.sqlite.prepare('SELECT * FROM local_workspace').all()).toEqual([])
})

it('requires explicit context for every business command before any resource side effects', async () => {
  const { rawApp, repository, root } = fixture()
  const global = new Set(['workspace:current', 'settings:get-theme', 'settings:set-theme'])
  const other = '00000000-0000-4000-8000-000000000001'
  for (const channel of rawApp.channels.filter((channel) => !global.has(channel))) {
    for (const input of [
      undefined,
      null,
      {},
      { payload: 'env' },
      { workspaceId: repository.workspaceId, payload: undefined, path: root },
    ]) {
      expect(await rawApp.invoke(channel, input), channel).toMatchObject({
        ok: false,
        code: 'WORKSPACE_CONTEXT_INVALID',
      })
    }
    expect(
      await rawApp.invoke(channel, { workspaceId: other, payload: 'same-id' }),
      channel,
    ).toMatchObject({ ok: false, code: 'WORKSPACE_MISMATCH' })
  }
  expect(repository.listAll()).toEqual([])
  expect(repository.listProxies()).toEqual([])
  expect(repository.listOperations()).toEqual([])
  expect(existsSync(join(root, 'credentials.json'))).toBe(false)
  expect(existsSync(join(root, 'worker-results'))).toBe(false)
})

it('does not cross independent roots when resource IDs and display names are identical', async () => {
  const a = fixture(),
    b = fixture()
  for (const f of [a, b])
    f.repository.create({
      config: environmentConfigSchema.parse({
        environmentId: 'same-id',
        name: 'Same display name',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
      }),
      dataDir: join(f.root, 'environments', 'same-id'),
      platform: 'darwin',
      arch: 'arm64',
    })
  expect(a.repository.workspaceId).not.toBe(b.repository.workspaceId)
  expect(
    await a.rawApp.invoke('environment:get', { ...b.repository.context, payload: 'same-id' }),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_MISMATCH' })
  expect(await a.app.invoke('environment:get', 'same-id')).toMatchObject({
    ok: true,
    data: { id: 'same-id', workspaceId: a.repository.workspaceId },
  })
  expect(await b.app.invoke('environment:get', 'same-id')).toMatchObject({
    ok: true,
    data: { id: 'same-id', workspaceId: b.repository.workspaceId },
  })
  expect(
    await a.app.invoke('environment:update', {
      version: 1,
      environmentId: 'same-id',
      expectedRevision: 1,
      name: 'Only A',
      browserSettings: {
        language: 'system',
        timezone: 'system',
        window: { width: 1280, height: 800 },
      },
      proxyId: null,
    }),
  ).toMatchObject({ ok: true })
  expect(a.repository.get('same-id')?.name).toBe('Only A')
  expect(b.repository.get('same-id')?.name).toBe('Same display name')
})

it('rechecks controlled roots after startup and refuses a replaced symlink before creating resources', async () => {
  const a = fixture(),
    b = fixture()
  rmSync(join(a.root, 'environments'), { recursive: true })
  symlinkSync(
    join(b.root, 'environments'),
    join(a.root, 'environments'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const before = readdirSync(join(b.root, 'environments'))
  expect(
    await a.app.invoke('environment:create', {
      name: 'Must not create',
      kernelId: 'standard-chromium',
      commonConfig: {},
    }),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_PATH_UNSAFE' })
  expect(await a.app.invoke('storage:orphans')).toMatchObject({
    ok: false,
    code: 'WORKSPACE_PATH_UNSAFE',
  })
  expect(a.repository.listAll()).toEqual([])
  expect(a.repository.listOperations()).toEqual([])
  expect(readdirSync(join(b.root, 'environments'))).toEqual(before)
  // Restore the fixture root so teardown exercises normal shutdown, not another test error.
  rmSync(join(a.root, 'environments'))
  mkdirSync(join(a.root, 'environments'))
})

it('keeps organization CRUD behind the fixed workspace boundary and emits source-owned events', async () => {
  const f = fixture(),
    other = fixture()
  expect(
    await f.rawApp.invoke('organization:group-create', {
      ...other.repository.context,
      payload: { name: 'foreign' },
    }),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_MISMATCH' })
  expect(await f.rawApp.invoke('organization:group-create', { name: 'unscoped' })).toMatchObject({
    ok: false,
    code: 'WORKSPACE_CONTEXT_INVALID',
  })
  expect(f.repository.organization.snapshot().groups).toEqual([])
  expect(await f.app.invoke('organization:group-create', { name: 'Owned group' })).toMatchObject({
    ok: true,
    data: { workspaceId: f.repository.workspaceId, name: 'Owned group', revision: 1 },
  })
  expect(f.events.at(-1)).toEqual({
    workspaceId: f.repository.workspaceId,
    domains: ['organization'],
  })
  expect(other.repository.organization.snapshot().groups).toEqual([])
  expect(await f.app.invoke('organization:group-create', { name: 'OWNED GROUP' })).toMatchObject({
    ok: false,
    code: 'ORGANIZATION_NAME_EXISTS',
  })
  const snapshot = f.repository.organization.snapshot()
  expect(
    await f.app.invoke('organization:group-delete', {
      id: snapshot.groups[0]!.id,
      expectedRevision: 999,
    }),
  ).toMatchObject({ ok: false, code: 'ORGANIZATION_CONFLICT' })
  expect(f.repository.organization.snapshot()).toEqual(snapshot)
})

it('owns backend batch previews, confirmations, facts and events at the application boundary', async () => {
  const { app, rawApp, repository, events } = fixture()
  const foreign = '00000000-0000-4000-8000-000000000009'
  for (const channel of [
    'batch:preview',
    'batch:confirm',
    'batch:page',
    'batch:get',
    'batch:cancel',
    'batch:retry-preview',
  ]) {
    expect(await rawApp.invoke(channel)).toMatchObject({
      ok: false,
      code: 'WORKSPACE_CONTEXT_INVALID',
    })
    expect(await rawApp.invoke(channel, { workspaceId: foreign, payload: {} })).toMatchObject({
      ok: false,
      code: 'WORKSPACE_MISMATCH',
    })
  }
  const result = await app.invoke('batch:preview', { action: 'start', environmentIds: ['missing'] })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected preview')
  const parsed = (await import('@contextweave/contracts')).batchPreviewSchema.parse(result.data)
  expect(parsed.workspaceId).toBe(repository.workspaceId)
  const confirmed = await app.invoke('batch:confirm', parsed.id)
  expect(confirmed).toMatchObject({
    ok: true,
    data: { status: 'completed', counts: { skipped: 1 } },
  })
  expect(await app.invoke('batch:confirm', parsed.id)).toEqual(confirmed)
  expect(await app.invoke('batch:get', parsed.id)).toEqual(confirmed)
  expect(await app.invoke('batch:page', {})).toMatchObject({
    ok: true,
    data: { workspaceId: repository.workspaceId, items: [{ id: parsed.id }] },
  })
  expect(await app.invoke('batch:retry-preview', parsed.id)).toMatchObject({
    ok: false,
    code: 'BATCH_NO_FAILED_ITEMS',
  })
  expect(events.some((event) => event.domains.includes('batches'))).toBe(true)
  expect(events.every((event) => event.workspaceId === repository.workspaceId)).toBe(true)
})

describe('public durable environment command boundary', () => {
  function prepare() {
    const f = fixture(),
      dataDir = join(f.root, 'environments', 'command-target')
    mkdirSync(dataDir)
    const config = environmentConfigSchema.parse({
      environmentId: 'command-target',
      name: 'Original',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
    })
    f.repository.create({ config, dataDir, platform: 'darwin', arch: 'arm64' })
    return { ...f, config, dataDir }
  }
  async function completed(
    app: ReturnType<typeof fixture>['app'],
    requestId: string,
    status = 'succeeded',
  ) {
    await vi.waitFor(async () =>
      expect(await app.invoke('environment:command-get', requestId)).toMatchObject({
        ok: true,
        data: { requestId, status },
      }),
    )
  }
  it('exposes bounded read-only receipt pages and complete active state only in the owning workspace', async () => {
    const f = prepare(),
      requestId = randomUUID()
    const request = {
      requestId,
      kind: 'update',
      input: {
        version: 1,
        environmentId: 'command-target',
        expectedRevision: 1,
        name: 'Paged',
        proxyId: null,
        browserSettings: {
          language: 'system',
          timezone: 'system',
          window: { width: 1440, height: 900 },
        },
      },
    }
    expect(await f.app.invoke('environment:command', request)).toMatchObject({ ok: true })
    await completed(f.app, requestId)
    expect(await f.app.invoke('environment:command-page', { limit: 1 })).toMatchObject({
      ok: true,
      data: {
        workspaceId: f.repository.workspaceId,
        items: [{ requestId, status: 'succeeded' }],
        nextBeforeId: null,
      },
    })
    expect(await f.app.invoke('environment:command-active')).toMatchObject({
      ok: true,
      data: { workspaceId: f.repository.workspaceId, items: [] },
    })
    for (const channel of ['environment:command-page', 'environment:command-active']) {
      expect(
        await f.rawApp.invoke(channel, { workspaceId: randomUUID(), payload: {} }),
      ).toMatchObject({ ok: false, code: 'WORKSPACE_MISMATCH' })
    }
    expect(await f.app.invoke('environment:command-page', { limit: 101 })).toMatchObject({
      ok: false,
    })
    expect(
      await f.app.invoke('environment:command-page', { beforeId: randomUUID() }),
    ).toMatchObject({ ok: false, code: 'COMMAND_CURSOR_INVALID' })
    expect(f.repository.get('command-target')?.name).toBe('Paged')
    expect(f.repository.commands.get(requestId)?.status).toBe('succeeded')
  })
  it('executes concurrent duplicate updates once, retains receipts after log cleanup and rejects different intent', async () => {
    const f = prepare(),
      requestId = randomUUID()
    const request = {
      requestId,
      kind: 'update',
      input: {
        version: 1,
        environmentId: 'command-target',
        expectedRevision: 1,
        name: 'Updated',
        proxyId: null,
        browserSettings: {
          language: 'en-US',
          timezone: 'UTC',
          window: { width: 1000, height: 800 },
        },
      },
    }
    const replies = await Promise.all([
      f.app.invoke('environment:command', request),
      f.app.invoke('environment:command', request),
    ])
    for (const reply of replies)
      expect(reply).toMatchObject({
        ok: true,
        data: { requestId, environmentId: 'command-target' },
      })
    await completed(f.app, requestId)
    expect(f.repository.get('command-target')).toMatchObject({
      name: 'Updated',
      revision: 2,
      dataDir: f.dataDir,
    })
    expect(f.repository.listOperations()).toHaveLength(1)
    f.db.sqlite.exec('DELETE FROM operations')
    expect(await f.app.invoke('environment:command', request)).toMatchObject({
      ok: true,
      data: { status: 'succeeded' },
    })
    expect(f.repository.listOperations()).toHaveLength(0)
    expect(
      await f.app.invoke('environment:command', {
        ...request,
        input: { ...request.input, name: 'Different' },
      }),
    ).toMatchObject({ ok: false, code: 'COMMAND_INTENT_CONFLICT' })
    expect(f.repository.get('command-target')?.revision).toBe(2)
  })
  it('checks the frozen revision inside the reservation before any mutation', async () => {
    const f = prepare(),
      requestId = randomUUID()
    const pending = f.app.invoke('environment:command', {
      requestId,
      kind: 'trash',
      environmentId: 'command-target',
      expectedRevision: 1,
    })
    f.repository.updateConfig({ ...f.config, name: 'External edit' }, 1)
    expect(await pending).toMatchObject({ ok: true })
    await completed(f.app, requestId, 'failed')
    expect(await f.app.invoke('environment:command-get', requestId)).toMatchObject({
      ok: true,
      data: { errorCode: 'CONFIG_CONFLICT' },
    })
    expect(f.repository.get('command-target')).toMatchObject({
      lifecycle: 'active',
      name: 'External edit',
    })
  })
  it('retains the same Main-assigned creation identity on a refused create and excludes intent bodies from lookup', async () => {
    const f = prepare(),
      requestId = randomUUID(),
      before = readdirSync(join(f.root, 'environments'))
    const request = {
      requestId,
      kind: 'create',
      input: { name: 'Unavailable', kernelId: 'not-an-installed-kernel' },
    }
    const first = await f.app.invoke('environment:command', request)
    expect(first).toMatchObject({ ok: true, data: { requestId, kind: 'create' } })
    await completed(f.app, requestId, 'failed')
    const next = await f.app.invoke('environment:command', request)
    if (!first.ok || !next.ok) throw new Error('fixture command should have durable admission')
    const receipt = f.repository.commands.get(requestId)!
    expect(first.data).toMatchObject({ environmentId: receipt.environmentId })
    expect(next.data).toMatchObject({
      environmentId: receipt.environmentId,
      errorCode: 'PROVIDER_UNVERIFIED',
    })
    for (const field of ['intentDigest', 'input', 'config', 'credential', 'dataDir'])
      expect(next.data).not.toHaveProperty(field)
    expect(readdirSync(join(f.root, 'environments'))).toEqual(before)
  })
  it('validates ownership, exposes read-only recovery inspection and preserves named legacy operations', async () => {
    const f = prepare(),
      requestId = randomUUID()
    expect(
      await f.rawApp.invoke('environment:command-get', {
        workspaceId: randomUUID(),
        payload: requestId,
      }),
    ).toMatchObject({ ok: false, code: 'WORKSPACE_MISMATCH' })
    const before = f.repository.get('command-target')
    expect(await f.app.invoke('environment:recovery-inspect', 'command-target')).toMatchObject({
      ok: true,
      data: { revision: 1, canRecover: true, lockState: 'absent' },
    })
    expect(f.repository.get('command-target')).toEqual(before)
    expect(await f.app.invoke('environment:delete', 'command-target')).toEqual({
      ok: true,
      data: true,
    })
    expect(f.repository.get('command-target')?.lifecycle).toBe('trashed')
    expect(await f.app.invoke('environment:restore', 'command-target')).toMatchObject({
      ok: true,
      data: { lifecycle: 'active' },
    })
    expect(existsSync(f.dataDir)).toBe(true)
    expect(f.db.sqlite.prepare('SELECT count(*) AS n FROM environment_commands').get()?.n).toBe(2)
  })
})
