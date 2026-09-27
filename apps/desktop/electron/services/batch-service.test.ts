import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { environmentConfigSchema, type IpcResult } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createBatchService, batchPreviewTtlMs, batchCommandRequestId } from './batch-service'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fn of cleanups.splice(0).reverse()) await fn()
})
function deferred() {
  let resolve!: (value: IpcResult<unknown>) => void
  const promise = new Promise<IpcResult<unknown>>((r) => {
    resolve = r
  })
  cleanups.push(async () => {
    resolve({ ok: false, code: 'CANCELLED', message: 'CANCELLED' })
  })
  return { promise, resolve }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-batch-service-')),
    db = openLocalDatabase(join(root, 'db.sqlite')),
    repository = new EnvironmentRepository(db.sqlite)
  for (const id of ['a', 'b', 'c']) {
    const dataDir = join(root, id)
    mkdirSync(dataDir)
    repository.create({
      config: environmentConfigSchema.parse({
        environmentId: id,
        name: id,
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
      }),
      dataDir,
      platform: 'darwin',
      arch: 'arm64',
    })
  }
  let time = Date.now(),
    monotonic = 0
  const execute = vi
      .fn<
        (
          action: string,
          id: string,
          revision: number,
          requestId: string,
        ) => Promise<IpcResult<unknown>>
      >()
      .mockResolvedValue({ ok: true, data: true }),
    changed = vi.fn(),
    busy = vi.fn(() => false)
  const service = createBatchService({
    repository,
    execute,
    changed,
    busy,
    clock: { now: () => time, monotonic: () => monotonic },
  })
  cleanups.push(async () => {
    await service.shutdown()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    db,
    repository,
    service,
    execute,
    changed,
    busy,
    advance: (ms: number) => {
      time += ms
      monotonic += ms
    },
    rewindWall: () => {
      time -= 3600000
      monotonic += batchPreviewTtlMs
    },
  }
}
describe('Main-owned serial batch queue', () => {
  it('has no preview side effects, freezes revisions/targets and executes one receipt despite duplicate confirm', async () => {
    const { service, execute, repository } = fixture(),
      gate = deferred()
    execute.mockImplementationOnce(() => gate.promise)
    const p = service.preview({ action: 'start', environmentIds: ['a', 'b', 'missing'] })
    expect(execute).not.toHaveBeenCalled()
    p.targets[0]!.environmentId = 'c'
    const task = service.confirm(p.id)
    expect(service.confirm(p.id).id).toBe(task.id)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const record = repository.get('b')!
    repository.updateConfig(
      environmentConfigSchema.parse({ ...JSON.parse(record.configJson), name: 'changed' }),
      record.revision,
    )
    gate.resolve({ ok: true, data: true })
    await service.drain()
    expect(execute.mock.calls).toEqual([
      ['start', 'a', 1, batchCommandRequestId(repository.workspaceId, task.id, 0)],
    ])
    expect(
      service.get(task.id).items.map((item) => [item.environmentId, item.status, item.reason]),
    ).toEqual([
      ['a', 'succeeded', null],
      ['b', 'skipped', 'CONFIG_CONFLICT'],
      ['missing', 'skipped', 'NOT_FOUND'],
    ])
    expect(service.confirm(p.id).status).toBe('completed')
  })
  it('continues without a page listener, serializes multiple batches, and cancels only unstarted items', async () => {
    const { service, execute, repository } = fixture(),
      gate = deferred()
    execute.mockImplementationOnce(() => gate.promise)
    const a = service.confirm(service.preview({ action: 'start', environmentIds: ['a', 'b'] }).id)
    const b = service.confirm(service.preview({ action: 'start', environmentIds: ['c'] }).id)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0]).toEqual([
      'start',
      'a',
      1,
      batchCommandRequestId(repository.workspaceId, a.id, 0),
    ])
    expect(service.page({}).items).toHaveLength(2)
    expect(service.cancel(a.id).status).toBe('cancelling')
    gate.resolve({ ok: true, data: true })
    await service.drain()
    expect(execute.mock.calls.map((call) => call[1])).toEqual(['a', 'c'])
    expect(service.get(a.id).counts).toMatchObject({ succeeded: 1, cancelled: 1 })
    expect(service.get(b.id).status).toBe('completed')
  })
  it('offers only definite failures for fresh explicit retry, not skipped/cancelled/successful items', async () => {
    const { service, execute } = fixture()
    execute.mockResolvedValueOnce({ ok: false, code: 'KERNEL_UNAVAILABLE', message: 'not copied' })
    const task = service.confirm(
      service.preview({ action: 'start', environmentIds: ['a', 'b', 'missing'] }).id,
    )
    await service.drain()
    const retry = service.retryPreview(task.id)
    expect(retry.targets.map((item) => item.environmentId)).toEqual(['a'])
    expect(retry.sourceTaskId).toBe(task.id)
    expect(execute).toHaveBeenCalledTimes(2)
    service.confirm(retry.id)
    await service.drain()
    expect(execute).toHaveBeenCalledTimes(3)
  })
  it('expires on monotonic time, bounds previews and refuses unknown identifiers', () => {
    const f = fixture(),
      p = f.service.preview({ action: 'trash', environmentIds: ['a'] })
    f.rewindWall()
    expect(() => f.service.confirm(p.id)).toThrow('BATCH_PREVIEW_EXPIRED')
    expect(() => f.service.confirm(randomUUID())).toThrow('BATCH_PREVIEW_INVALID')
    for (let i = 0; i < 20; i++) f.service.preview({ action: 'start', environmentIds: ['a'] })
    expect(() => f.service.preview({ action: 'start', environmentIds: ['a'] })).toThrow(
      'BATCH_PREVIEW_LIMIT',
    )
    f.advance(batchPreviewTtlMs)
    expect(() => f.service.preview({ action: 'start', environmentIds: ['a'] })).not.toThrow()
  })
  it('rechecks runtime/busy state and never automatically replays recovered uncertain effects', async () => {
    const { service, repository, execute, busy } = fixture(),
      p = service.preview({ action: 'start', environmentIds: ['a'] })
    busy.mockReturnValue(true)
    const task = service.confirm(p.id)
    await service.drain()
    expect(service.get(task.id).items[0]?.reason).toBe('OPERATION_IN_PROGRESS')
    expect(execute).not.toHaveBeenCalled()
    busy.mockReturnValue(false)
    const candidate = service.preview({ action: 'start', environmentIds: ['b'] })
    repository.batches.create(candidate)
    repository.batches.startItem(candidate.id, 0)
    service.recover()
    expect(service.get(candidate.id).items[0]?.status).toBe('unknown')
    expect(() => service.retryPreview(candidate.id)).toThrow('BATCH_NO_FAILED_ITEMS')
    expect(execute).not.toHaveBeenCalled()
  })
  it('stops new effects on storage failure and leaves in-flight result unresolved rather than claiming success', async () => {
    const { service, repository, execute } = fixture()
    vi.spyOn(repository.batches, 'finishItem').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const task = service.confirm(
      service.preview({ action: 'start', environmentIds: ['a', 'b'] }).id,
    )
    await service.drain()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(() => service.get(task.id)).toThrow('BATCH_STORAGE_FAILED')
    expect(repository.batches.get(task.id)?.items.map((item) => item.status)).toEqual([
      'running',
      'queued',
    ])
    repository.batches.recoverInterrupted()
    expect(repository.batches.get(task.id)?.counts.unknown).toBe(1)
  })
  it('shutdown cancels queued items, waits for the active effect and rejects new work', async () => {
    const { service, execute } = fixture(),
      gate = deferred()
    execute.mockImplementationOnce(() => gate.promise)
    const task = service.confirm(
      service.preview({ action: 'start', environmentIds: ['a', 'b'] }).id,
    )
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    let closed = false
    const quitting = service.shutdown().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(() => service.preview({ action: 'start', environmentIds: ['c'] })).toThrow('APP_CLOSING')
    gate.resolve({ ok: true, data: true })
    await quitting
    expect(service.get(task.id).counts).toMatchObject({ succeeded: 1, cancelled: 1 })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

it('retains uncertain execution as unknown and excludes it from failed-only retry', async () => {
  const { service, execute } = fixture()
  execute.mockResolvedValueOnce({ ok: false, code: 'COMMAND_RESULT_UNKNOWN', message: 'unknown' })
  const task = service.confirm(service.preview({ action: 'start', environmentIds: ['a', 'b'] }).id)
  await service.drain()
  expect(service.get(task.id).counts).toMatchObject({ unknown: 1, succeeded: 1, failed: 0 })
  expect(service.get(task.id).items[0]).toMatchObject({
    status: 'unknown',
    reason: 'BATCH_INTERRUPTED',
  })
  expect(() => service.retryPreview(task.id)).toThrow('BATCH_NO_FAILED_ITEMS')
})
it('keeps deterministic batch command IDs separate by owner, batch and ordinal', () => {
  const owner = randomUUID(),
    batch = randomUUID()
  const id = batchCommandRequestId(owner, batch, 0)
  expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  expect(batchCommandRequestId(owner, batch, 0)).toBe(id)
  expect(batchCommandRequestId(owner, batch, 1)).not.toBe(id)
  expect(batchCommandRequestId(randomUUID(), batch, 0)).not.toBe(id)
  expect(batchCommandRequestId(owner, randomUUID(), 0)).not.toBe(id)
})
