const workspace = { workspaceId: '00000000-0000-4000-8000-000000000001' }
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextWeaveApi } from './preload'
import type { WorkerTask } from '@contextweave/worker-protocol'

type Handler = (event: unknown, value: unknown) => void
const bridge = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>()
  return {
    listeners,
    expose: vi.fn<(name: string, value: ContextWeaveApi) => void>(),
    invoke: vi.fn<(channel: string, input?: unknown) => Promise<unknown>>(),
    on: vi.fn((channel: string, handler: Handler) => {
      const subscribers = listeners.get(channel) ?? new Set<Handler>()
      subscribers.add(handler)
      listeners.set(channel, subscribers)
    }),
    remove: vi.fn((channel: string, handler: Handler) => listeners.get(channel)?.delete(handler)),
  }
})
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke, on: bridge.on, removeListener: bridge.remove },
}))
let api: ContextWeaveApi
beforeAll(async () => {
  await import('./preload')
  expect(bridge.expose).toHaveBeenCalledOnce()
  const exposed = bridge.expose.mock.calls[0]
  if (!exposed) throw new Error('Preload did not expose its API')
  expect(exposed[0]).toBe('contextweave')
  api = exposed[1]
})
beforeEach(() => {
  bridge.invoke.mockReset()
  bridge.on.mockClear()
  bridge.remove.mockClear()
  bridge.listeners.clear()
})
const task: WorkerTask = {
  protocolVersion: 1,
  taskId: 'task-test',
  environmentId: 'env-test',
  kind: 'browser-smoke',
  input: { url: 'https://example.invalid/', timeoutMs: 1000 },
}

describe('sandboxed preload contract', () => {
  it('exposes only the named product API, never raw IPC, Node, or shell capabilities', () => {
    expect(Object.keys(api).sort()).toEqual([
      'activity',
      'app',
      'batch',
      'bookmarks',
      'environment',
      'events',
      'kernel',
      'logs',
      'operation',
      'organization',
      'proxy',
      'settings',
      'storage',
      'update',
      'worker',
      'workspace',
    ])
    for (const group of Object.values(api))
      for (const forbidden of ['invoke', 'send', 'on', 'require', 'exec', 'fs', 'ipcRenderer'])
        expect(Object.hasOwn(group, forbidden)).toBe(false)
  })

  it('validates requests before invoking Main and rejects private worker envelope fields', async () => {
    await expect(api.environment.start(workspace, '')).rejects.toThrow()
    await expect(api.worker.cancel(workspace, '../outside')).rejects.toThrow()
    await expect(
      api.worker.runSmoke(workspace, { ...task, taskId: '../outside' }),
    ).rejects.toThrow()
    const privateFields = { ...task, controlPort: 9222, proxyCredentials: { password: 'secret' } }
    await expect(api.worker.runSmoke(workspace, privateFields)).rejects.toThrow()
    for (const url of ['file:///private', 'javascript:alert(1)', 'https://u:p@example.test'])
      await expect(api.app.openExternal(url)).rejects.toThrow()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('normalizes a valid request and returns a validated success or structured failure', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: [] })
    expect(await api.environment.list(workspace)).toEqual({ ok: true, data: [] })
    expect(bridge.invoke).toHaveBeenCalledWith('environment:list', {
      ...workspace,
      payload: undefined,
    })
    const denied = { ok: false, code: 'FORBIDDEN', message: 'FORBIDDEN' }
    bridge.invoke.mockResolvedValue(denied)
    expect(await api.environment.start(workspace, ' env-test ')).toEqual(denied)
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:start', {
      ...workspace,
      payload: 'env-test',
    })
  })

  it.each([
    undefined,
    null,
    [],
    { ok: true },
    { ok: 'true', data: [] },
    { ok: true, data: [{ id: 'incomplete' }] },
    { ok: false, message: 'missing code' },
  ])(
    'rejects malformed response envelope %j instead of passing it to Renderer',
    async (response) => {
      bridge.invoke.mockResolvedValue(response)
      await expect(api.environment.list(workspace)).rejects.toThrow()
    },
  )

  it('uses the shared app information contract rather than accepting arbitrary platform strings', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: {
        name: 'App',
        version: '0.1.6',
        platform: 'unknown',
        arch: 'arm64',
        secureStorageAvailable: true,
      },
    })
    await expect(api.app.getInfo()).rejects.toThrow()
    bridge.invoke.mockRejectedValue(new Error('IPC closed'))
    await expect(api.app.getInfo()).rejects.toThrow('IPC closed')
  })

  it('only forwards validated domains, never the Electron event, and unsubscribes each listener', () => {
    const one = vi.fn()
    const two = vi.fn()
    const unsubscribe = api.events.onDataChanged(workspace, one)
    const unsubscribeTwo = api.events.onDataChanged(workspace, two)
    const emit = (value: unknown) => {
      for (const handler of bridge.listeners.get('data:changed') ?? [])
        handler({ sender: 'must-not-cross-the-bridge' }, value)
    }
    emit({ ...workspace, domains: ['environments', 'proxies'] })
    expect(one).toHaveBeenCalledExactlyOnceWith(['environments', 'proxies'])
    emit({ ...workspace, domains: ['private-domain'] })
    emit(null)
    emit({ workspaceId: '00000000-0000-4000-8000-000000000002', domains: ['kernels'] })
    emit({ domains: ['kernels'] })
    emit({ ...workspace, domains: ['kernels'], extra: true })
    expect(one).toHaveBeenCalledOnce()
    unsubscribe()
    unsubscribe()
    emit({ ...workspace, domains: ['kernels'] })
    expect(one).toHaveBeenCalledOnce()
    expect(two).toHaveBeenLastCalledWith(['kernels'])
    unsubscribeTwo()
    expect(bridge.listeners.get('data:changed')?.size).toBe(0)
  })
})

it('validates both directions of the history page bridge', async () => {
  await expect(api.activity.page(workspace, { limit: 101 })).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  const page = { items: [], previousCursor: null, nextCursor: null }
  bridge.invoke.mockResolvedValue({ ok: true, data: page })
  expect(await api.operation.page(workspace, { limit: 3 })).toEqual({ ok: true, data: page })
  expect(bridge.invoke).toHaveBeenCalledWith('operation:page', {
    ...workspace,
    payload: expect.objectContaining({ limit: 3, sortBy: 'startedAt', cursor: null }),
  })
  bridge.invoke.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } })
  await expect(api.activity.page(workspace)).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ ok: false, code: 'HISTORY_CURSOR_STALE', message: 'stale' })
  expect(await api.activity.page(workspace)).toMatchObject({
    ok: false,
    code: 'HISTORY_CURSOR_STALE',
  })
})

it('whitelists history maintenance and validates the bounded request/response protocol', async () => {
  await expect(
    api.storage.previewHistoryCleanup(workspace, {
      retentionDays: 90,
      cutoffAt: 'unsafe',
    } as never),
  ).rejects.toThrow()
  await expect(
    api.storage.confirmHistoryCleanup(workspace, { previewId: 'operation-id' }),
  ).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ok: true, data: null })
  expect(await api.storage.getHistoryCleanupReceipt(workspace)).toEqual({ ok: true, data: null })
  expect(bridge.invoke).toHaveBeenLastCalledWith('storage:history-receipt', {
    ...workspace,
    payload: undefined,
  })
  const denied = { ok: false, code: 'HISTORY_CLEANUP_PREVIEW_EXPIRED', message: 'expired' }
  bridge.invoke.mockResolvedValue(denied)
  const input = { previewId: 'e4c3b366-6342-4630-b533-93ec809bafce' }
  expect(await api.storage.confirmHistoryCleanup(workspace, input)).toEqual(denied)
  expect(bridge.invoke).toHaveBeenLastCalledWith('storage:history-confirm', {
    ...workspace,
    payload: input,
  })
  bridge.invoke.mockResolvedValue({ ok: true, data: { receipt: null, replayed: false } })
  await expect(api.storage.confirmHistoryCleanup(workspace, input)).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ ok: true, data: { sessions: { count: 999 } } })
  await expect(
    api.storage.previewHistoryCleanup(workspace, { retentionDays: 90 }),
  ).rejects.toThrow()
})

it('validates artifact pagination both ways and rejects ownership/path leakage', async () => {
  const empty = {
    items: [],
    totals: { count: 0, bytes: 0 },
    previousCursor: null,
    nextCursor: null,
  }
  bridge.invoke.mockResolvedValue({ ok: true, data: empty })
  expect(await api.storage.pageArtifacts(workspace)).toEqual({ ok: true, data: empty })
  expect(bridge.invoke).toHaveBeenCalledWith('storage:artifacts-page', {
    ...workspace,
    payload: { limit: 20, cursor: null },
  })
  await expect(api.storage.pageArtifacts(workspace, { limit: 51 })).rejects.toThrow()
  const unsafe = { limit: 20, path: '/private' }
  await expect(api.storage.pageArtifacts(workspace, unsafe)).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ ok: true, data: { ...empty, path: '/private' } })
  await expect(api.storage.pageArtifacts(workspace)).rejects.toThrow()
  const item = {
    artifactId: '776c5484-731d-4d25-82d4-3a388986a125',
    environmentId: 'env',
    environmentName: 'Example',
    taskId: 'task',
    bytes: 8,
    sha256: 'a'.repeat(64),
    completedAt: '2026-09-27T00:00:00.000Z',
    ownership: {},
  }
  bridge.invoke.mockResolvedValue({ ok: true, data: { ...empty, items: [item] } })
  await expect(api.storage.pageArtifacts(workspace)).rejects.toThrow()
})

it('validates screenshot policies and accounting both ways without accepting arbitrary release commands', async () => {
  const budget = {
    limitMiB: 32,
    revision: 1,
    registered: { count: 0, bytes: 0 },
    reserved: { count: 0, bytes: 0 },
    availableBytes: 33554432,
  }
  bridge.invoke.mockResolvedValue({ ok: true, data: budget })
  expect(await api.storage.getArtifactBudget(workspace)).toEqual({ ok: true, data: budget })
  expect(bridge.invoke).toHaveBeenLastCalledWith('storage:artifact-budget', {
    ...workspace,
    payload: undefined,
  })
  await api.storage.updateArtifactBudget(workspace, { limitMiB: 32, expectedRevision: 1 })
  expect(bridge.invoke).toHaveBeenLastCalledWith('storage:artifact-budget-update', {
    ...workspace,
    payload: {
      limitMiB: 32,
      expectedRevision: 1,
    },
  })
  const invalid = { limitMiB: 32, expectedRevision: 1, releaseId: 'foreign' }
  await expect(api.storage.updateArtifactBudget(workspace, invalid)).rejects.toThrow()
  await expect(
    api.storage.updateArtifactBudget(workspace, { limitMiB: 1, expectedRevision: 1 }),
  ).rejects.toThrow()
  for (const value of [
    { ...budget, path: '/private' },
    { ...budget, availableBytes: 1 },
    { ...budget, reserved: { count: 1, bytes: 0 } },
  ]) {
    bridge.invoke.mockResolvedValue({ ok: true, data: value })
    await expect(api.storage.getArtifactBudget(workspace)).rejects.toThrow()
  }
})

it('reads only the local workspace identity and rejects payloads or private response fields', async () => {
  const identity = {
    workspaceId: 'd326147b-89da-40fa-8cc0-7b9ad0dfacb6',
    kind: 'personal',
    storageMode: 'local',
    createdAt: '2026-09-27T00:00:00.000Z',
  }
  bridge.invoke.mockResolvedValue({ ok: true, data: identity })
  expect(await api.workspace.current()).toEqual({ ok: true, data: identity })
  expect(bridge.invoke).toHaveBeenLastCalledWith('workspace:current')
  bridge.invoke.mockClear()
  await expect(
    Reflect.apply(api.workspace.current, undefined, [{ workspaceId: 'other' }]),
  ).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  for (const data of [
    { ...identity, kind: 'team' },
    { ...identity, workspaceId: '../outside' },
    { ...identity, dataRoot: '/private' },
  ]) {
    bridge.invoke.mockResolvedValue({ ok: true, data })
    await expect(api.workspace.current()).rejects.toThrow()
  }
  expect(Object.keys(api.workspace)).toEqual(['current'])
})

it('never supplies a default workspace for a missing, malformed or extra-field context', async () => {
  for (const context of [
    undefined,
    null,
    {},
    { workspaceId: 'not-a-uuid' },
    { ...workspace, path: '/private' },
  ])
    await expect(Reflect.apply(api.environment.list, undefined, [context])).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
})

it('rejects otherwise valid owned records from another workspace, including paged results', async () => {
  const foreign = '00000000-0000-4000-8000-000000000002'
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: [
      {
        workspaceId: foreign,
        proxyId: 'same-id',
        type: 'http',
        host: 'proxy.invalid',
        port: 8080,
        hasPassword: false,
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    ],
  })
  await expect(api.proxy.list(workspace)).rejects.toThrow('WORKSPACE_MISMATCH')
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: {
      items: [
        {
          workspaceId: foreign,
          operationId: 'same-id',
          environmentId: null,
          kind: 'install',
          status: 'succeeded',
          phase: 'completed',
          startedAt: '2026-09-27T00:00:00.000Z',
          endedAt: null,
          errorCode: null,
        },
      ],
      nextCursor: null,
      previousCursor: null,
    },
  })
  await expect(api.operation.page(workspace)).rejects.toThrow('WORKSPACE_MISMATCH')
})

it('validates named organization methods and rejects mixed-owner snapshots before Renderer state', async () => {
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: { ...workspace, groups: [], tags: [], environments: [], views: [] },
  })
  await expect(api.organization.list(workspace)).resolves.toMatchObject({ ok: true })
  expect(bridge.invoke).toHaveBeenLastCalledWith('organization:list', {
    ...workspace,
    payload: undefined,
  })
  bridge.invoke.mockClear()
  await expect(
    api.organization.saveEnvironment(workspace, {
      environmentId: 'env',
      groupId: null,
      tags: ['duplicate', 'DUPLICATE'],
      note: '',
      expectedRevision: 0,
    }),
  ).rejects.toThrow()
  await expect(
    api.organization.deleteGroup(workspace, { id: 'not-uuid', expectedRevision: 1 }),
  ).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: {
      ...workspace,
      groups: [],
      tags: [],
      views: [],
      environments: [
        {
          workspaceId: '00000000-0000-4000-8000-000000000002',
          environmentId: 'same-id',
          groupId: null,
          tags: [],
          note: 'private',
          revision: 0,
        },
      ],
    },
  })
  await expect(api.organization.list(workspace)).rejects.toThrow()
})

it('validates batch requests and refuses a foreign task container even with ownerless child snapshots', async () => {
  await expect(
    api.batch.preview(workspace, { action: 'start', environmentIds: ['same', 'same'] }),
  ).rejects.toThrow()
  await expect(api.batch.confirm(workspace, '../../outside')).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: { workspaceId: '00000000-0000-4000-8000-000000000009', items: [] },
  })
  await expect(api.batch.get(workspace, '00000000-0000-4000-8000-000000000004')).rejects.toThrow(
    'WORKSPACE_MISMATCH',
  )
  expect(bridge.invoke).toHaveBeenLastCalledWith('batch:get', {
    ...workspace,
    payload: '00000000-0000-4000-8000-000000000004',
  })
})

describe('durable command preload API', () => {
  const requestId = '9c0fb113-0c8d-46c7-a1e8-48dfb0958e13'
  const request = { requestId, kind: 'start' as const, environmentId: 'env', expectedRevision: 1 }
  const receipt = {
    ...workspace,
    version: 1,
    ...request,
    status: 'queued',
    createdAt: '2026-09-27T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
    errorCode: null,
  }
  it('validates bounded receipt pages and complete active snapshots with nested ownership and cursor consistency', async () => {
    const page = { ...workspace, items: [receipt], nextBeforeId: null }
    bridge.invoke.mockResolvedValue({ ok: true, data: page })
    expect(await api.environment.commandPage(workspace, { limit: 20 })).toEqual({
      ok: true,
      data: page,
    })
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:command-page', {
      ...workspace,
      payload: { beforeId: null, limit: 20 },
    })
    const active = { ...workspace, items: [receipt] }
    bridge.invoke.mockResolvedValue({ ok: true, data: active })
    expect(await api.environment.activeCommands(workspace)).toEqual({ ok: true, data: active })
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:command-active', {
      ...workspace,
      payload: undefined,
    })
    const other = '5daf9da1-242b-4dfd-b3ea-96e7b00a9f7d'
    for (const bad of [
      { ...page, items: [{ ...receipt, workspaceId: other }] },
      { ...page, items: [receipt, receipt] },
      { ...page, nextBeforeId: other },
      { ...page, items: [], nextBeforeId: requestId },
      { ...page, items: Array.from({ length: 101 }, () => receipt) },
    ]) {
      bridge.invoke.mockResolvedValue({ ok: true, data: bad })
      await expect(api.environment.commandPage(workspace, {})).rejects.toThrow()
    }
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: {
        ...workspace,
        items: [
          {
            ...receipt,
            status: 'succeeded',
            startedAt: receipt.createdAt,
            endedAt: receipt.createdAt,
          },
        ],
      },
    })
    await expect(api.environment.activeCommands(workspace)).rejects.toThrow()
    bridge.invoke.mockClear()
    for (const input of [{ limit: 0 }, { limit: 101 }, { beforeId: 'invalid' }])
      await expect(api.environment.commandPage(workspace, input)).rejects.toThrow()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
  it('retains caller request identity and validates both request and owner-bound receipt', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: receipt })
    expect(await api.environment.submitCommand(workspace, request)).toEqual({
      ok: true,
      data: receipt,
    })
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:command', {
      ...workspace,
      payload: request,
    })
    expect(await api.environment.commandReceipt(workspace, requestId)).toEqual({
      ok: true,
      data: receipt,
    })
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:command-get', {
      ...workspace,
      payload: requestId,
    })
    expect(await api.environment.cancelCommand(workspace, requestId)).toEqual({
      ok: true,
      data: receipt,
    })
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:command-cancel', {
      ...workspace,
      payload: requestId,
    })
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { ...receipt, workspaceId: '5daf9da1-242b-4dfd-b3ea-96e7b00a9f7d' },
    })
    await expect(api.environment.commandReceipt(workspace, requestId)).rejects.toThrow(
      'WORKSPACE_MISMATCH',
    )
  })
  it('refuses a valid receipt belonging to a different request, action or target in the same workspace', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { ...receipt, requestId: '67e7b89f-2a5f-414d-a067-147e6b40c67d' },
    })
    await expect(api.environment.commandReceipt(workspace, requestId)).rejects.toThrow(
      'COMMAND_RECEIPT_MISMATCH',
    )
    bridge.invoke.mockResolvedValue({ ok: true, data: { ...receipt, kind: 'stop' } })
    await expect(api.environment.submitCommand(workspace, request)).rejects.toThrow(
      'COMMAND_RECEIPT_MISMATCH',
    )
    bridge.invoke.mockResolvedValue({ ok: true, data: { ...receipt, environmentId: 'other' } })
    await expect(api.environment.submitCommand(workspace, request)).rejects.toThrow(
      'COMMAND_RECEIPT_MISMATCH',
    )
  })
  it('rejects malformed IDs, revisions, private payloads and impossible success facts', async () => {
    await expect(
      api.environment.submitCommand(workspace, { ...request, expectedRevision: 0 }),
    ).rejects.toThrow()
    await expect(api.environment.commandReceipt(workspace, 'not-an-id')).rejects.toThrow()
    expect(bridge.invoke).not.toHaveBeenCalled()
    for (const payload of [
      { ...receipt, intentDigest: 'a'.repeat(64) },
      { ...receipt, status: 'succeeded' },
    ]) {
      bridge.invoke.mockResolvedValue({ ok: true, data: payload })
      await expect(api.environment.commandReceipt(workspace, requestId)).rejects.toThrow()
    }
  })
})

it('validates tag CRUD inputs, revisions and responses under the captured workspace', async () => {
  const tag = {
    ...workspace,
    id: '00000000-0000-4000-8000-000000000010',
    name: 'Review',
    revision: 1,
    updatedAt: '2026-09-28T00:00:00.000Z',
  }
  bridge.invoke.mockResolvedValue({ ok: true, data: tag })
  expect(await api.organization.createTag(workspace, { name: ' Review ' })).toEqual({
    ok: true,
    data: tag,
  })
  expect(bridge.invoke).toHaveBeenLastCalledWith('organization:tag-create', {
    ...workspace,
    payload: { name: 'Review' },
  })
  await api.organization.updateTag(workspace, { id: tag.id, name: 'New', expectedRevision: 1 })
  expect(bridge.invoke).toHaveBeenLastCalledWith('organization:tag-update', {
    ...workspace,
    payload: { id: tag.id, name: 'New', expectedRevision: 1 },
  })
  bridge.invoke.mockResolvedValue({ ok: true, data: true })
  await api.organization.deleteTag(workspace, { id: tag.id, expectedRevision: 2 })
  expect(bridge.invoke).toHaveBeenLastCalledWith('organization:tag-delete', {
    ...workspace,
    payload: { id: tag.id, expectedRevision: 2 },
  })
  bridge.invoke.mockClear()
  await expect(api.organization.createTag(workspace, { name: '   ' })).rejects.toThrow()
  await expect(
    api.organization.updateTag(workspace, { id: tag.id, name: 'New', expectedRevision: 0 }),
  ).rejects.toThrow()
  await expect(
    api.organization.deleteTag(workspace, { id: 'bad', expectedRevision: 1 }),
  ).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ok: true, data: { ...tag, revision: 0 } })
  await expect(api.organization.createTag(workspace, { name: 'Review' })).rejects.toThrow()
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: { ...tag, workspaceId: '00000000-0000-4000-8000-000000000002' },
  })
  await expect(
    api.organization.updateTag(workspace, { id: tag.id, name: 'Review', expectedRevision: 1 }),
  ).rejects.toThrow('WORKSPACE_MISMATCH')
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: {
      ...workspace,
      groups: [],
      environments: [],
      views: [],
      tags: [{ ...tag, workspaceId: '00000000-0000-4000-8000-000000000002' }],
    },
  })
  await expect(api.organization.list(workspace)).rejects.toThrow()
})

it('validates scoped bookmark requests and refuses malformed or foreign success responses', async () => {
  const item = {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Example',
    url: 'https://example.test/',
  }
  await expect(
    api.bookmarks.save(workspace, {
      expectedRevision: 0,
      items: [{ ...item, url: 'https://u:p@example.test' }],
    }),
  ).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  const data = { ...workspace, revision: 1, items: [item] }
  bridge.invoke.mockResolvedValue({ ok: true, data })
  expect(await api.bookmarks.save(workspace, { expectedRevision: 0, items: [item] })).toEqual({
    ok: true,
    data,
  })
  expect(bridge.invoke).toHaveBeenCalledWith('bookmarks:save', {
    ...workspace,
    payload: { expectedRevision: 0, items: [item] },
  })
  bridge.invoke.mockResolvedValue({ ok: true, data: { ...data, workspaceId: item.id } })
  await expect(api.bookmarks.get(workspace)).rejects.toThrow('WORKSPACE_MISMATCH')
  bridge.invoke.mockResolvedValue({
    ok: true,
    data: { ...data, items: [{ ...item, url: 'file:///private' }] },
  })
  await expect(api.bookmarks.get(workspace)).rejects.toThrow()
})

it('exposes validated path-key copying without exposing arbitrary clipboard text', async () => {
  bridge.invoke.mockResolvedValue({ ok: true, data: true })
  expect(await api.app.copyPath('dataRoot')).toEqual({ ok: true, data: true })
  expect(bridge.invoke).toHaveBeenCalledWith('app:copy-path', 'dataRoot')
  bridge.invoke.mockClear()
  // Reflect invokes the runtime boundary with deliberately untyped Renderer input.
  await expect(Reflect.apply(api.app.copyPath, undefined, ['/private/secret'])).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ok: true, data: 'not-a-boolean' })
  await expect(api.app.copyPath('logRoot')).rejects.toThrow()
})

it('validates bounded management APIs on both sides of the sandbox bridge', async () => {
  await expect(api.kernel.rename(workspace, { id: '../outside', name: 'x' })).rejects.toThrow()
  await expect(api.kernel.removeMany(workspace, ['one', 'one'])).rejects.toThrow()
  await expect(api.organization.deleteTags(workspace, [])).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ok: true, data: [{ id: 'one', ok: true }] })
  expect(await api.kernel.removeMany(workspace, ['one'])).toEqual({
    ok: true,
    data: [{ id: 'one', ok: true }],
  })
  expect(bridge.invoke).toHaveBeenCalledWith('kernel:remove-many', {
    ...workspace,
    payload: ['one'],
  })
  bridge.invoke.mockResolvedValue({ ok: true, data: [{ id: 'one', ok: false, code: '/secret' }] })
  await expect(api.kernel.removeMany(workspace, ['one'])).rejects.toThrow()
})

it('validates and forwards the installation name in the scoped request', async () => {
  await expect(api.kernel.install(workspace, 'managed-one', 'x'.repeat(81))).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ok: false, code: 'RELEASE_UNREVIEWED', message: 'Refused' })
  await api.kernel.install(workspace, 'managed-one', ' Work browser ')
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('kernel:install', {
    ...workspace,
    payload: { id: 'managed-one', name: 'Work browser' },
  })
})
