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
      'environment',
      'events',
      'kernel',
      'logs',
      'operation',
      'proxy',
      'settings',
      'storage',
      'update',
      'worker',
    ])
    for (const group of Object.values(api))
      for (const forbidden of ['invoke', 'send', 'on', 'require', 'exec', 'fs', 'ipcRenderer'])
        expect(Object.hasOwn(group, forbidden)).toBe(false)
  })

  it('validates requests before invoking Main and rejects private worker envelope fields', async () => {
    await expect(api.environment.start('')).rejects.toThrow()
    await expect(api.worker.cancel('../outside')).rejects.toThrow()
    await expect(api.worker.runSmoke({ ...task, taskId: '../outside' })).rejects.toThrow()
    const privateFields = { ...task, controlPort: 9222, proxyCredentials: { password: 'secret' } }
    await expect(api.worker.runSmoke(privateFields)).rejects.toThrow()
    for (const url of ['file:///private', 'javascript:alert(1)', 'https://u:p@example.test'])
      await expect(api.app.openExternal(url)).rejects.toThrow()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('normalizes a valid request and returns a validated success or structured failure', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: [] })
    expect(await api.environment.list()).toEqual({ ok: true, data: [] })
    expect(bridge.invoke).toHaveBeenCalledWith('environment:list')
    const denied = { ok: false, code: 'FORBIDDEN', message: 'FORBIDDEN' }
    bridge.invoke.mockResolvedValue(denied)
    expect(await api.environment.start(' env-test ')).toEqual(denied)
    expect(bridge.invoke).toHaveBeenLastCalledWith('environment:start', 'env-test')
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
      await expect(api.environment.list()).rejects.toThrow()
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
    const unsubscribe = api.events.onDataChanged(one)
    const unsubscribeTwo = api.events.onDataChanged(two)
    const emit = (value: unknown) => {
      for (const handler of bridge.listeners.get('data:changed') ?? [])
        handler({ sender: 'must-not-cross-the-bridge' }, value)
    }
    emit({ domains: ['environments', 'proxies'] })
    expect(one).toHaveBeenCalledExactlyOnceWith(['environments', 'proxies'])
    emit({ domains: ['private-domain'] })
    emit(null)
    expect(one).toHaveBeenCalledOnce()
    unsubscribe()
    unsubscribe()
    emit({ domains: ['kernels'] })
    expect(one).toHaveBeenCalledOnce()
    expect(two).toHaveBeenLastCalledWith(['kernels'])
    unsubscribeTwo()
    expect(bridge.listeners.get('data:changed')?.size).toBe(0)
  })
})
