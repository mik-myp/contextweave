import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  environmentCommandReceiptSchema,
  type EnvironmentCommandRequest,
  type EnvironmentCommandReceipt,
  type IpcResult,
} from '@contextweave/contracts'
import { createEnvironmentCommandClient, PendingEnvironmentCommandError } from './command-client'
const context = { workspaceId: randomUUID() }
const start = { kind: 'start' as const, environmentId: 'env', expectedRevision: 1 }
function receipt(
  request: EnvironmentCommandRequest,
  status: EnvironmentCommandReceipt['status'] = 'succeeded',
) {
  const target =
    request.kind === 'create' ? null : request.kind === 'update' ? request.input : request
  const at = new Date().toISOString()
  return environmentCommandReceiptSchema.parse({
    ...context,
    version: 1,
    requestId: request.requestId,
    kind: request.kind,
    environmentId: target?.environmentId ?? 'main-created',
    expectedRevision: target?.expectedRevision ?? null,
    createdAt: at,
    startedAt: status === 'queued' ? null : at,
    endedAt: ['queued', 'running'].includes(status) ? null : at,
    status,
    errorCode:
      status === 'unknown'
        ? 'COMMAND_RESULT_UNKNOWN'
        : status === 'failed'
          ? 'CONFIG_CONFLICT'
          : null,
  })
}
function fixture() {
  const values = new Map<string, string>()
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  let accepted: EnvironmentCommandRequest | undefined
  const api = {
    submitCommand: vi.fn(
      async (input: EnvironmentCommandRequest): Promise<IpcResult<EnvironmentCommandReceipt>> => {
        accepted = input
        return { ok: true, data: receipt(input) }
      },
    ),
    commandReceipt: vi.fn(async (): Promise<IpcResult<EnvironmentCommandReceipt>> =>
      accepted
        ? { ok: true, data: receipt(accepted) }
        : { ok: false, code: 'NOT_FOUND', message: 'not found' },
    ),
  }
  const create = () =>
    createEnvironmentCommandClient({ context, api, storage, now: () => Date.now() })
  const client = create()
  return { client, api, storage, values, create }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('caller-stable environment command identity', () => {
  it('records public tracking facts before sending once, then clears a confirmed successful operation', async () => {
    const f = fixture()
    f.api.submitCommand.mockImplementation(async (request) => {
      expect(f.storage.setItem).toHaveBeenCalledOnce()
      expect(f.client.getSnapshot().entries[0]?.requestId).toBe(request.requestId)
      return { ok: true, data: receipt(request) }
    })
    expect((await f.client.execute(start)).status).toBe('succeeded')
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
    expect(f.client.getSnapshot().entries).toEqual([])
    expect(f.api.commandReceipt).not.toHaveBeenCalled()
  })
  it('looks up the original ID after a lost reply, rather than resubmitting or generating another effect', async () => {
    const f = fixture()
    let original: EnvironmentCommandRequest
    f.api.submitCommand.mockImplementation(async (request) => {
      original = request
      throw new Error('reply lost')
    })
    f.api.commandReceipt.mockImplementation(async () => ({ ok: true, data: receipt(original) }))
    const result = await f.client.execute(start)
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
    expect(f.api.commandReceipt).toHaveBeenCalledWith(result.requestId)
    expect(f.client.getSnapshot().entries).toEqual([])
  })
  it('preserves an unconfirmed ID across another click and a reload, including changed form intent', async () => {
    const f = fixture()
    f.api.submitCommand.mockRejectedValue(new Error('disconnected'))
    await expect(
      f.client.execute({ kind: 'create', input: { name: 'first', kernelId: 'standard-chromium' } }),
    ).rejects.toBeInstanceOf(PendingEnvironmentCommandError)
    const entry = f.client.getSnapshot().entries[0]!
    const reopened = f.create()
    expect(reopened.getSnapshot().entries[0]?.requestId).toBe(entry.requestId)
    await expect(
      reopened.execute({
        kind: 'create',
        input: { name: 'different intent', kernelId: 'standard-chromium' },
      }),
    ).rejects.toMatchObject({ requestId: entry.requestId })
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
    await expect(reopened.check(entry.requestId)).resolves.toEqual({ state: 'not-found' })
    expect(reopened.getSnapshot().entries).toHaveLength(1)
  })
  it('never treats a delayed successful submission reply as permission to clear an uncertain index', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let resolve!: (value: IpcResult<EnvironmentCommandReceipt>) => void,
      request!: EnvironmentCommandRequest
    f.api.submitCommand.mockImplementation((input) => {
      request = input
      return new Promise((done) => {
        resolve = done
      })
    })
    const failed = expect(f.client.execute(start)).rejects.toBeInstanceOf(
      PendingEnvironmentCommandError,
    )
    await vi.advanceTimersByTimeAsync(3001)
    await failed
    const requestId = f.client.getSnapshot().entries[0]!.requestId
    resolve({ ok: true, data: receipt(request) })
    await Promise.resolve()
    expect(f.client.getSnapshot().entries[0]?.requestId).toBe(requestId)
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
    f.api.commandReceipt.mockResolvedValue({ ok: true, data: receipt(request) })
    await f.client.check(requestId)
    expect(f.client.getSnapshot().entries).toHaveLength(1)
    f.client.acknowledge(requestId)
    expect(f.client.getSnapshot().entries).toEqual([])
  })
  it('ends bounded observation without cancelling a live Main task or silently allocating another ID', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let original!: EnvironmentCommandRequest
    f.api.submitCommand.mockImplementation(async (request) => {
      original = request
      return { ok: true, data: receipt(request, 'queued') }
    })
    f.api.commandReceipt.mockImplementation(async () => ({
      ok: true,
      data: receipt(original, 'running'),
    }))
    const pending = expect(f.client.execute(start)).rejects.toBeInstanceOf(
      PendingEnvironmentCommandError,
    )
    await vi.advanceTimersByTimeAsync(30001)
    await pending
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
    const id = f.client.getSnapshot().entries[0]!.requestId
    await f.client.check(id)
    expect(() => f.client.acknowledge(id)).toThrow()
    expect(f.client.getSnapshot().entries).toHaveLength(1)
  })
  it('retains unknown effects until explicit lookup and acknowledgement, without deleting any Main facts', async () => {
    const f = fixture()
    let original!: EnvironmentCommandRequest
    f.api.submitCommand.mockImplementation(async (request) => {
      original = request
      return { ok: true, data: receipt(request, 'unknown') }
    })
    await expect(f.client.execute(start)).rejects.toBeInstanceOf(PendingEnvironmentCommandError)
    const id = f.client.getSnapshot().entries[0]!.requestId
    f.api.commandReceipt.mockImplementation(async () => ({
      ok: true,
      data: receipt(original, 'unknown'),
    }))
    expect(await f.client.check(id)).toMatchObject({
      state: 'found',
      receipt: { status: 'unknown' },
    })
    expect(f.client.getSnapshot().entries).toHaveLength(1)
    f.client.acknowledge(id)
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
    expect(f.api.commandReceipt).toHaveBeenCalledOnce()
  })
  it('does not dispatch if tracking cannot be written, or erase unreadable tracking on startup', async () => {
    const f = fixture()
    f.storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    await expect(f.client.execute(start)).rejects.toThrow()
    expect(f.api.submitCommand).not.toHaveBeenCalled()
    expect(f.client.getSnapshot().problem).toBe('COMMAND_TRACKING_UNAVAILABLE')
    const bad = fixture()
    bad.storage.getItem.mockReturnValue('not JSON')
    const reopened = bad.create()
    expect(bad.storage.setItem).not.toHaveBeenCalled()
    await expect(reopened.execute(start)).rejects.toThrow()
    expect(bad.api.submitCommand).not.toHaveBeenCalled()
  })
  it('does not persist intent bodies, credentials or configuration, and never reads another workspace index', async () => {
    const f = fixture()
    f.api.submitCommand.mockRejectedValue(new Error('lost'))
    await expect(
      f.client.execute({
        kind: 'create',
        input: {
          name: 'private name',
          kernelId: 'standard-chromium',
          kernelConfig: { untrustedSecret: 'never-persist' },
        },
      }),
    ).rejects.toThrow()
    const raw = [...f.values.values()][0]!
    expect(raw).not.toContain('private name')
    expect(raw).not.toContain('untrustedSecret')
    expect(raw).not.toContain('never-persist')
    const other = createEnvironmentCommandClient({
      context: { workspaceId: randomUUID() },
      api: f.api,
      storage: f.storage,
    })
    expect(other.getSnapshot().entries).toEqual([])
    expect(f.create().getSnapshot().entries).toHaveLength(1)
  })
  it('refuses mismatched receipts and retains the original identity rather than misreporting success', async () => {
    const f = fixture()
    f.api.submitCommand.mockImplementation(async (request) => ({
      ok: true,
      data: { ...receipt(request), requestId: randomUUID() },
    }))
    await expect(f.client.execute(start)).rejects.toBeInstanceOf(PendingEnvironmentCommandError)
    expect(f.client.getSnapshot().entries).toHaveLength(1)
    expect(f.api.submitCommand).toHaveBeenCalledOnce()
  })
  it('stops observers on session exit but preserves original IDs; a StrictMode remount can still perform new work', async () => {
    const f = fixture()
    f.api.submitCommand.mockImplementationOnce(() => new Promise(() => {}))
    const pending = expect(f.client.execute(start)).rejects.toBeInstanceOf(
      PendingEnvironmentCommandError,
    )
    f.client.stopObserving()
    await pending
    expect(f.client.getSnapshot().entries).toHaveLength(1)
    expect((await f.client.execute({ ...start, environmentId: 'other' })).status).toBe('succeeded')
    expect(f.client.getSnapshot().entries[0]?.environmentId).toBe('env')
  })
})

it('sanitizes failed lookups instead of displaying native paths or raw receipt validation details', async () => {
  const f = fixture()
  f.api.submitCommand.mockRejectedValue(new Error('lost'))
  await expect(f.client.execute(start)).rejects.toBeInstanceOf(PendingEnvironmentCommandError)
  const id = f.client.getSnapshot().entries[0]!.requestId
  f.api.commandReceipt.mockRejectedValue(new Error('/private/credential?password=do-not-display'))
  await expect(f.client.check(id)).rejects.toThrow('结果尚未确认')
  expect(f.client.getSnapshot().entries[0]!.requestId).toBe(id)
  expect(f.api.submitCommand).toHaveBeenCalledOnce()
})
it('does not retain a late lookup observation after acknowledgement removes its journal entry', async () => {
  const f = fixture()
  f.api.submitCommand.mockRejectedValue(new Error('lost'))
  await expect(f.client.execute(start)).rejects.toBeInstanceOf(PendingEnvironmentCommandError)
  const id = f.client.getSnapshot().entries[0]!.requestId
  await f.client.check(id)
  let settle!: (value: IpcResult<EnvironmentCommandReceipt>) => void
  f.api.commandReceipt.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve
      }),
  )
  const late = f.client.check(id)
  f.client.acknowledge(id)
  settle({ ok: false, code: 'NOT_FOUND', message: 'not found' })
  await late
  expect(() => f.client.acknowledge(id)).toThrow('先按原编号查证')
  expect(f.client.getSnapshot().entries).toEqual([])
})
it('retains tracking when saving a completed result fails and does not claim the effect was never sent', async () => {
  const f = fixture()
  f.storage.setItem
    .mockImplementationOnce((key, value) => {
      f.values.set(key, value)
    })
    .mockImplementationOnce(() => {
      throw new Error('full')
    })
  await expect(f.client.execute(start)).rejects.toBeInstanceOf(PendingEnvironmentCommandError)
  expect(f.client.getSnapshot().problem).toBe('COMMAND_TRACKING_UNAVAILABLE')
  expect(f.client.getSnapshot().entries).toHaveLength(1)
  await expect(f.client.execute(start)).rejects.toThrow('已提交的请求')
  expect(f.api.submitCommand).toHaveBeenCalledOnce()
})
