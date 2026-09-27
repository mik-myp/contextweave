import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { environmentConfigSchema, type IpcResult } from '@contextweave/contracts'
import { createEnvironmentCommands, type CommandOutcome } from './environment-commands'
import { createBatchService, batchCommandRequestId } from './batch-service'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-shared-command-')),
    db = openLocalDatabase(join(root, 'db.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
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
  let release!: (outcome: CommandOutcome) => void
  const held = new Promise<CommandOutcome>((resolve) => {
    release = resolve
  })
  const execute = vi.fn<Parameters<typeof createEnvironmentCommands>[0]['execute']>(
    async (_request, receipt) =>
      receipt.environmentId === 'a' ? held : { status: 'succeeded', errorCode: null },
  )
  const commands = createEnvironmentCommands({
    store: repository.commands,
    execute,
    cancelStart: vi.fn(),
    changed: vi.fn(),
  })
  const batches = createBatchService({
    repository,
    busy: commands.busy,
    changed: vi.fn(),
    cancelQueuedCommand: commands.cancelIfQueued,
    execute: async (
      kind,
      environmentId,
      expectedRevision,
      requestId,
    ): Promise<IpcResult<unknown>> => {
      const receipt = commands.submit({ requestId, kind, environmentId, expectedRevision })
      const done = await commands.wait(receipt.requestId)
      return done.status === 'succeeded'
        ? { ok: true, data: true }
        : { ok: false, code: done.errorCode ?? 'COMMAND_RESULT_UNKNOWN', message: 'safe' }
    },
  })
  cleanup.push(async () => {
    release({ status: 'succeeded', errorCode: null })
    await Promise.all([
      commands.shutdown().catch(() => undefined),
      batches.shutdown().catch(() => undefined),
    ])
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { db, repository, commands, batches, execute, release }
}
describe('single and batch commands share reservations and the startup lane', () => {
  it('cancels a batch item waiting behind a single startup before any browser effect, retaining both receipts', async () => {
    const f = fixture()
    f.commands.submit({
      requestId: randomUUID(),
      kind: 'start',
      environmentId: 'a',
      expectedRevision: 1,
    })
    const preview = f.batches.preview({ action: 'start', environmentIds: ['b'] }),
      task = f.batches.confirm(preview.id)
    const requestId = batchCommandRequestId(f.repository.workspaceId, task.id, 0)
    await vi.waitFor(() => expect(f.repository.commands.get(requestId)?.status).toBe('queued'))
    expect(f.execute.mock.calls.map((call) => call[1].environmentId)).toEqual(['a'])
    expect(
      f.commands.submit({
        requestId: randomUUID(),
        kind: 'trash',
        environmentId: 'b',
        expectedRevision: 1,
      }).errorCode,
    ).toBe('OPERATION_IN_PROGRESS')
    f.batches.cancel(task.id)
    await f.batches.drain()
    expect(f.batches.get(task.id)).toMatchObject({ status: 'cancelled', counts: { cancelled: 1 } })
    expect(f.repository.commands.get(requestId)).toMatchObject({
      status: 'cancelled',
      startedAt: null,
    })
    expect(f.execute).toHaveBeenCalledTimes(1)
    f.release({ status: 'succeeded', errorCode: null })
    await f.commands.drain()
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('does not start a single command while a batch owns startup, or accept another batch targeting that reserved environment', async () => {
    const f = fixture()
    const task = f.batches.confirm(f.batches.preview({ action: 'start', environmentIds: ['a'] }).id)
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1))
    const single = f.commands.submit({
      requestId: randomUUID(),
      kind: 'start',
      environmentId: 'b',
      expectedRevision: 1,
    })
    expect(f.batches.preview({ action: 'start', environmentIds: ['b'] }).targets[0]?.reason).toBe(
      'OPERATION_IN_PROGRESS',
    )
    expect(f.commands.get(single.requestId).status).toBe('queued')
    f.release({ status: 'succeeded', errorCode: null })
    await Promise.all([f.commands.drain(), f.batches.drain()])
    expect(f.execute.mock.calls.map((call) => call[1].environmentId)).toEqual(['a', 'b'])
    expect(f.batches.get(task.id).counts.succeeded).toBe(1)
    expect(f.commands.get(single.requestId).status).toBe('succeeded')
  })
  it('halts both dispatchers rather than invoking later effects after an underlying operation log failure', async () => {
    const f = fixture()
    const task = f.batches.confirm(
      f.batches.preview({ action: 'start', environmentIds: ['a', 'b'] }).id,
    )
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1))
    f.commands.submit({
      requestId: randomUUID(),
      kind: 'start',
      environmentId: 'c',
      expectedRevision: 1,
    })
    f.release({ status: 'unknown', errorCode: 'COMMAND_STORAGE_FAILED' })
    await Promise.all([f.commands.drain(), f.batches.drain()])
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(f.repository.batches.get(task.id)?.items.map((item) => item.status)).toEqual([
      'unknown',
      'queued',
    ])
    expect(() => f.batches.get(task.id)).toThrow('BATCH_STORAGE_FAILED')
    expect(() => f.commands.get(randomUUID())).toThrow('COMMAND_STORAGE_FAILED')
    expect(
      f.repository.commands.get(batchCommandRequestId(f.repository.workspaceId, task.id, 0))
        ?.status,
    ).toBe('unknown')
  })
})
