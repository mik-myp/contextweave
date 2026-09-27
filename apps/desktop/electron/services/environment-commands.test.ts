import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import {
  environmentCommandRequestSchema,
  type EnvironmentCommandReceipt,
  type EnvironmentCommandKind,
} from '@contextweave/contracts'
import { createEnvironmentCommands, type CommandOutcome } from './environment-commands'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const success: CommandOutcome = { status: 'succeeded', errorCode: null }
function gate() {
  let resolve!: (outcome: CommandOutcome) => void
  const promise = new Promise<CommandOutcome>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
type Execute = Parameters<typeof createEnvironmentCommands>[0]['execute']
function fixture(execute = vi.fn<Execute>(async () => success)) {
  const db = openLocalDatabase(':memory:'),
    repo = new EnvironmentRepository(db.sqlite)
  const cancelStart = vi.fn(),
    changed = vi.fn()
  const service = createEnvironmentCommands({ store: repo.commands, execute, cancelStart, changed })
  cleanups.push(async () => {
    await service.shutdown().catch(() => undefined)
    db.close()
  })
  return { service, db, repo, execute, cancelStart, changed }
}
function request(kind: EnvironmentCommandKind, environmentId = 'env') {
  if (kind === 'create')
    return environmentCommandRequestSchema.parse({
      requestId: randomUUID(),
      kind,
      input: { name: 'Create', kernelId: 'standard-chromium' },
    })
  if (kind === 'update')
    return environmentCommandRequestSchema.parse({
      requestId: randomUUID(),
      kind,
      input: {
        version: 1,
        environmentId,
        expectedRevision: 1,
        name: 'Edit',
        proxyId: null,
        browserSettings: {
          language: 'en-US',
          timezone: 'UTC',
          window: { width: 1000, height: 800 },
        },
      },
    })
  return environmentCommandRequestSchema.parse({
    requestId: randomUUID(),
    kind,
    environmentId,
    expectedRevision: 1,
  })
}

describe('durable environment command execution', () => {
  it('deduplicates creates before, during and after execution with Main-assigned target identity', async () => {
    const held = gate(),
      f = fixture(vi.fn(() => held.promise))
    cleanups.push(async () => held.resolve(success))
    const input = request('create')
    const first = f.service.submit(input)
    expect(first.environmentId).toMatch(/^env-[a-f0-9-]{36}$/)
    expect(f.service.submit(input)).toEqual(first)
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1))
    expect(f.service.submit(input).status).toBe('running')
    held.resolve(success)
    const done = await f.service.wait(first.requestId)
    expect(done.status).toBe('succeeded')
    expect(f.service.submit(input)).toEqual(done)
    expect(f.execute.mock.calls[0]).toMatchObject([input, { environmentId: first.environmentId }])
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it.each(['create', 'update', 'start', 'stop', 'trash', 'restore', 'recover'] as const)(
    'executes %s through the durable boundary',
    async (kind) => {
      const f = fixture(),
        input = request(kind),
        receipt = f.service.submit(input)
      expect(f.service.busy(receipt.environmentId)).toBe(true)
      expect((await f.service.wait(receipt.requestId)).status).toBe('succeeded')
      expect(f.service.busy(receipt.environmentId)).toBe(false)
      expect(f.execute).toHaveBeenCalledTimes(1)
    },
  )
  it('keeps accepted input independent of caller mutation and rejects mismatched reuse without freezing healthy work', async () => {
    const f = fixture(),
      input = request('create')
    const first = f.service.submit(input)
    if (input.kind !== 'create') throw new Error('fixture')
    input.input.name = 'Changed after acceptance'
    expect(() => f.service.submit(input)).toThrow('COMMAND_INTENT_CONFLICT')
    expect((await f.service.wait(first.requestId)).status).toBe('succeeded')
    expect(f.execute.mock.calls[0]?.[0]).toMatchObject({ input: { name: 'Create' } })
    expect(f.service.submit(request('start', 'new')).status).toBe('queued')
    await f.service.drain()
  })
  it('runs FIFO starts serially, reserves queued targets, and does not limit already-running browsers', async () => {
    const first = gate(),
      second = gate(),
      order: string[] = []
    const execute = vi.fn(async (_request: unknown, receipt: EnvironmentCommandReceipt) => {
      order.push(receipt.environmentId)
      return receipt.environmentId === 'a'
        ? first.promise
        : receipt.environmentId === 'b'
          ? second.promise
          : success
    })
    const f = fixture(execute)
    cleanups.push(async () => {
      first.resolve(success)
      second.resolve(success)
    })
    const a = f.service.submit(request('start', 'a')),
      b = f.service.submit(request('start', 'b')),
      c = f.service.submit(request('start', 'c'))
    await vi.waitFor(() => expect(order).toEqual(['a']))
    expect(f.service.get(b.requestId).status).toBe('queued')
    expect(f.service.submit(request('update', 'b'))).toMatchObject({
      status: 'failed',
      errorCode: 'OPERATION_IN_PROGRESS',
    })
    first.resolve(success)
    await f.service.wait(a.requestId)
    await vi.waitFor(() => expect(order).toEqual(['a', 'b']))
    expect(f.service.get(c.requestId).status).toBe('queued')
    second.resolve(success)
    await f.service.drain()
    expect(order).toEqual(['a', 'b', 'c'])
    expect(f.service.get(a.requestId).status).toBe('succeeded')
    expect(f.service.get(c.requestId).status).toBe('succeeded')
  })
  it('stops unrelated environments and cancels queued starts without waiting for another startup', async () => {
    const held = gate(),
      order: string[] = []
    const f = fixture(
      vi.fn(async (_request: unknown, receipt: EnvironmentCommandReceipt) => {
        order.push(`${receipt.kind}:${receipt.environmentId}`)
        return receipt.environmentId === 'a' ? held.promise : success
      }),
    )
    cleanups.push(async () => held.resolve(success))
    f.service.submit(request('start', 'a'))
    const queued = f.service.submit(request('start', 'b'))
    await vi.waitFor(() => expect(order).toEqual(['start:a']))
    const unrelated = f.service.submit(request('stop', 'c')),
      stopQueued = f.service.submit(request('stop', 'b'))
    expect((await f.service.wait(unrelated.requestId)).status).toBe('succeeded')
    expect((await f.service.wait(stopQueued.requestId)).status).toBe('succeeded')
    expect(f.service.get(queued.requestId)).toMatchObject({
      status: 'cancelled',
      startedAt: null,
      errorCode: 'CANCELLED',
    })
    expect(order).toEqual(['start:a', 'stop:c', 'stop:b'])
    expect(f.cancelStart).not.toHaveBeenCalled()
    held.resolve(success)
    await f.service.drain()
    expect(order).not.toContain('start:b')
  })
  it('persists a stop before cancelling its own in-flight start, excludes third commands, and waits only for that start', async () => {
    const held = gate(),
      other = gate(),
      order: string[] = []
    const f = fixture(
      vi.fn(async (_request: unknown, receipt: EnvironmentCommandReceipt) => {
        order.push(`${receipt.kind}:${receipt.environmentId}`)
        return receipt.kind === 'stop'
          ? success
          : receipt.environmentId === 'a'
            ? held.promise
            : other.promise
      }),
    )
    cleanups.push(async () => {
      held.resolve(success)
      other.resolve(success)
    })
    const a = f.service.submit(request('start', 'a'))
    f.service.submit(request('start', 'b'))
    await vi.waitFor(() => expect(order).toEqual(['start:a']))
    const stopRequest = request('stop', 'a')
    f.cancelStart.mockImplementation(() =>
      expect(f.repo.commands.get(stopRequest.requestId)?.status).toBe('queued'),
    )
    const stop = f.service.submit(stopRequest)
    expect(f.service.submit(stopRequest)).toEqual(stop)
    expect(f.cancelStart).toHaveBeenCalledTimes(1)
    expect(f.service.submit(request('update', 'a')).errorCode).toBe('OPERATION_IN_PROGRESS')
    expect(order).toEqual(['start:a'])
    held.resolve({ status: 'cancelled', errorCode: 'CANCELLED' })
    expect((await f.service.wait(a.requestId)).status).toBe('cancelled')
    expect((await f.service.wait(stop.requestId)).status).toBe('succeeded')
    await vi.waitFor(() => expect(f.repo.commands.active('b')?.status).toBe('running'))
    other.resolve(success)
  })
  it('only cancels unstarted work and does not reinterpret an executing cancellation request as completion', async () => {
    const held = gate(),
      f = fixture(vi.fn(() => held.promise))
    cleanups.push(async () => held.resolve(success))
    const a = f.service.submit(request('start', 'a')),
      b = f.service.submit(request('start', 'b'))
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1))
    expect(() => f.service.cancel(a.requestId)).toThrow('OPERATION_IN_PROGRESS')
    expect(f.service.cancel(b.requestId)).toMatchObject({
      status: 'cancelled',
      errorCode: 'CANCELLED',
    })
    expect(f.service.cancel(b.requestId).status).toBe('cancelled')
    held.resolve(success)
    await f.service.drain()
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('marks thrown/uncertain effects unknown, never replays them, and recovers interrupted facts without dispatch', async () => {
    const f = fixture(
      vi.fn(async () => {
        throw new Error('private raw failure')
      }),
    )
    const input = request('start'),
      receipt = f.service.submit(input)
    const unknown = await f.service.wait(receipt.requestId)
    expect(unknown).toMatchObject({ status: 'unknown', errorCode: 'COMMAND_RESULT_UNKNOWN' })
    expect(f.service.submit(input)).toEqual(unknown)
    expect(f.service.submit(request('start')).errorCode).toBe('RECOVERY_REQUIRED')
    const identity = {
      version: 1 as const,
      workspaceId: f.repo.workspaceId,
      requestId: randomUUID(),
      kind: 'start' as const,
      environmentId: 'old',
      expectedRevision: 1,
      intentDigest: 'a'.repeat(64),
    }
    f.repo.commands.reserve(identity)
    f.repo.commands.start(identity.requestId)
    f.service.recover()
    expect(f.service.get(identity.requestId)).toMatchObject({
      status: 'unknown',
      errorCode: 'COMMAND_INTERRUPTED',
    })
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('cancels queued work on shutdown, waits for in-flight effects, rejects new work and permits receipt lookup', async () => {
    const held = gate(),
      f = fixture(vi.fn(() => held.promise))
    cleanups.push(async () => held.resolve(success))
    const input = request('start', 'a'),
      a = f.service.submit(input),
      b = f.service.submit(request('start', 'b'))
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1))
    let ended = false
    const shutdown = f.service.shutdown().then(() => {
      ended = true
    })
    expect(f.service.get(b.requestId)).toMatchObject({
      status: 'cancelled',
      errorCode: 'APP_CLOSING',
    })
    expect(f.service.submit(request('start', 'c')).errorCode).toBe('APP_CLOSING')
    expect(ended).toBe(false)
    held.resolve(success)
    await shutdown
    expect(f.service.submit(input)).toEqual(f.service.get(a.requestId))
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('never launches when durable acceptance fails, and does not let invalid read IDs poison healthy execution', async () => {
    const f = fixture()
    expect(() => f.service.get('invalid')).toThrow()
    const invalidUpdate = request('update')
    if (invalidUpdate.kind !== 'update') throw new Error('fixture')
    invalidUpdate.input.environmentId = 'x'.repeat(513)
    expect(() => f.service.submit(invalidUpdate)).toThrow()
    const first = f.service.submit(request('start'))
    await f.service.wait(first.requestId)
    f.db.sqlite.exec(
      "CREATE TEMP TRIGGER fault BEFORE INSERT ON environment_commands BEGIN SELECT RAISE(ABORT,'injected'); END",
    )
    expect(() => f.service.submit(request('start', 'b'))).toThrow('COMMAND_STORAGE_FAILED')
    expect(() => f.service.submit(request('start', 'c'))).toThrow('COMMAND_STORAGE_FAILED')
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('does not report success or dispatch queued work after result persistence fails', async () => {
    const held = gate(),
      f = fixture(vi.fn(() => held.promise))
    cleanups.push(async () => held.resolve(success))
    const a = f.service.submit(request('start', 'a')),
      b = f.service.submit(request('start', 'b'))
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1))
    const waiting = f.service.wait(a.requestId)
    f.db.sqlite.exec(
      "CREATE TEMP TRIGGER fault BEFORE UPDATE ON environment_commands WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'injected'); END",
    )
    held.resolve(success)
    await expect(waiting).rejects.toThrow('COMMAND_STORAGE_FAILED')
    await f.service.drain()
    expect(f.repo.commands.get(a.requestId)?.status).toBe('running')
    expect(f.repo.commands.get(b.requestId)?.status).toBe('queued')
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(() => f.service.submit(request('start', 'c'))).toThrow('COMMAND_STORAGE_FAILED')
  })
})
