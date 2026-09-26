import { EventEmitter, once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  maxWorkerScreenshotBytes,
  maxWorkerScreenshotChunkBytes,
  type WorkerParentMessage,
} from '@contextweave/worker-protocol'
import { createWorkerService, workerStopGraceMs } from './worker-service'
import { createWorkerOutput } from './worker-output'
import type { WorkerProcess } from './worker-process'

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2])
const roots: string[] = []
const children: FixtureWorker[] = []
const services: ReturnType<typeof createWorkerService>[] = []
class FixtureWorker extends EventEmitter implements WorkerProcess {
  pid: number | undefined
  sent: WorkerParentMessage[] = []
  exitOnKill = true
  reaped = true
  exitNotified = false
  hasExited() {
    return this.exitNotified && this.reaped
  }
  kill = vi.fn(() => {
    if (this.exitOnKill) queueMicrotask(() => this.exit(143))
    return this.exitOnKill
  })
  postMessage(message: WorkerParentMessage) {
    this.sent.push(structuredClone(message))
    this.emit('parent-message', structuredClone(message))
  }
  start() {
    this.pid = 1234
    this.emit('spawn')
  }
  ready() {
    this.send({ type: 'ready' })
  }
  send(message: object) {
    this.emit('message', structuredClone({ version: 1, ...message }))
  }
  exit(code: number) {
    this.exitNotified = true
    this.pid = undefined
    this.emit('exit', code)
  }
}
afterEach(async () => {
  vi.useRealTimers()
  for (const child of children.splice(0)) child.exit(143)
  await Promise.all(services.splice(0).map((service) => service.shutdown()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function task(taskId = 'task-test') {
  return {
    protocolVersion: 1,
    taskId,
    environmentId: 'env-test',
    kind: 'browser-smoke',
    input: { url: 'http://127.0.0.1/', timeoutMs: 1000 },
  }
}
function setup(options: { allocate?: typeof createWorkerOutput; autoSpawn?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-worker-service-'))
  roots.push(root)
  const outputRoot = join(root, 'results')
  const leases: { access: { port: number; token: string }; revoke: ReturnType<typeof vi.fn> }[] = []
  const acquire = vi.fn(() => {
    const lease = { access: { port: 9222, token: 'a'.repeat(64) }, revoke: vi.fn() }
    leases.push(lease)
    return lease
  })
  const created: FixtureWorker[] = []
  const fork = vi.fn(() => {
    const child = new FixtureWorker()
    created.push(child)
    children.push(child)
    if (options.autoSpawn !== false)
      queueMicrotask(() => {
        child.start()
        child.ready()
      })
    return child
  })
  const service = createWorkerService(
    { session: (id) => (id === 'env-test' ? {} : undefined), leaseControl: acquire },
    'private-worker.js',
    outputRoot,
    fork,
    options.allocate,
  )
  services.push(service)
  const start = async () => {
    const running = service.run(task())
    const child = created.at(-1)!
    await vi.waitFor(() => expect(child.sent[0]?.type).toBe('request'))
    return { running, child }
  }
  return { root, outputRoot, acquire, leases, created, fork, service, start }
}
async function screenshot(child: FixtureWorker, data = png) {
  child.send({ type: 'screenshot-start', bytes: data.byteLength })
  let chunks = 0
  for (let start = 0; start < data.byteLength; start += maxWorkerScreenshotChunkBytes) {
    const acknowledgment = once(child, 'parent-message')
    child.send({
      type: 'screenshot-chunk',
      sequence: chunks,
      data: data.slice(start, start + maxWorkerScreenshotChunkBytes),
    })
    expect((await acknowledgment)[0]).toEqual({ version: 1, type: 'chunk-ack', sequence: chunks })
    chunks++
  }
  child.send({ type: 'screenshot-end', bytes: data.byteLength, chunks })
}
function result(child: FixtureWorker, extra: object = {}) {
  child.send({
    type: 'result',
    result: {
      protocolVersion: 1,
      taskId: 'task-test',
      environmentId: 'env-test',
      ok: true,
      title: 'A中文B',
      ...extra,
    },
  })
}

describe('utility worker service lifecycle', () => {
  it('requires a complete transfer AND actual successful exit, returning Main-owned paths', async () => {
    const { service, start, outputRoot, leases } = setup()
    const paths: string[] = []
    for (let index = 0; index < 2; index++) {
      const { child, running } = await start()
      await screenshot(child)
      result(child)
      expect(child.sent.at(-1)).toEqual({ version: 1, type: 'result-ack' })
      expect(await service.run(task('other'))).toMatchObject({
        ok: false,
        code: 'WORKER_BUSY',
        message: 'WORKER_BUSY',
      })
      let settled = false
      void running.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      child.exit(0)
      const outcome = await running
      expect(outcome).toMatchObject({ ok: true, data: { ok: true, title: 'A中文B' } })
      if (!outcome.ok || !outcome.data.screenshotPath) throw new Error('Missing output')
      paths.push(outcome.data.screenshotPath)
      expect(readFileSync(outcome.data.screenshotPath)).toEqual(Buffer.from(png))
    }
    expect(paths[0]).not.toBe(paths[1])
    expect(readdirSync(outputRoot)).toHaveLength(2)
    expect(leases.every((lease) => lease.revoke.mock.calls.length > 0)).toBe(true)
  })
  it('keeps output and environment ownership until OS exit is confirmed after the utility notification', async () => {
    const { start, service, outputRoot } = setup()
    const { child, running } = await start()
    await screenshot(child)
    result(child)
    child.reaped = false
    child.exit(0)
    let returned = false
    void running.then(() => {
      returned = true
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(returned).toBe(false)
    expect(await service.run(task('other'))).toEqual({
      ok: false,
      code: 'WORKER_BUSY',
      message: 'WORKER_BUSY',
    })
    expect(readdirSync(outputRoot)).toHaveLength(1)
    child.reaped = true
    expect(await running).toMatchObject({ ok: true, data: { ok: true } })
  })
  it.each([maxWorkerScreenshotChunkBytes * 2 + 10, maxWorkerScreenshotBytes])(
    'accepts %i bytes only after individual write acknowledgments',
    async (size) => {
      const { start } = setup()
      const { child, running } = await start()
      const bytes = new Uint8Array(size)
      bytes.set(png)
      await screenshot(child, bytes)
      result(child)
      child.exit(0)
      const outcome = await running
      if (!outcome.ok || !outcome.data.screenshotPath) throw new Error('Missing output')
      // Native byte comparison verifies all 32 MiB without Vitest enumerating millions of object keys.
      const captured = readFileSync(outcome.data.screenshotPath)
      expect(captured.byteLength).toBe(bytes.byteLength)
      expect(captured.equals(Buffer.from(bytes))).toBe(true)
    },
  )
  it.each(['../escape', '..\\escape', '/outside', 'C:\\outside', 'x'.repeat(129)])(
    'rejects task ID %j before allocating',
    async (id) => {
      const { service, outputRoot, fork } = setup()
      await expect(service.run(task(id))).rejects.toThrow()
      expect(existsSync(outputRoot)).toBe(false)
      expect(fork).not.toHaveBeenCalled()
    },
  )
  it('rejects task-supplied paths and private control metadata', async () => {
    const { service, outputRoot } = setup()
    for (const extra of [
      { outputDirectory: '/outside' },
      { control: { port: 1234, token: 'b'.repeat(64) } },
      { input: { ...task().input, screenshotPath: '/outside' } },
    ])
      await expect(service.run({ ...task(), ...extra })).rejects.toThrow()
    expect(existsSync(outputRoot)).toBe(false)
  })
  it.each(['missing-environment', 'lease-failure', 'fork-failure'])(
    'does not retain output after %s',
    async (mode) => {
      const { service, outputRoot, acquire, fork, leases } = setup()
      if (mode === 'lease-failure')
        acquire.mockImplementation(() => {
          throw new Error('private error')
        })
      if (mode === 'fork-failure')
        fork.mockImplementation(() => {
          throw new Error('private error')
        })
      const outcome = await service.run({
        ...task(),
        environmentId: mode === 'missing-environment' ? 'missing' : 'env-test',
      })
      expect(outcome).toEqual({
        ok: false,
        code: mode === 'missing-environment' ? 'ENVIRONMENT_NOT_RUNNING' : 'WORKER_FAILED',
        message: mode === 'missing-environment' ? 'ENVIRONMENT_NOT_RUNNING' : 'WORKER_FAILED',
      })
      expect(existsSync(outputRoot) ? readdirSync(outputRoot) : []).toEqual([])
      if (mode === 'fork-failure') expect(leases[0]?.revoke).toHaveBeenCalled()
    },
  )
  it.each([
    'wrong-version',
    'repeated-ready',
    'missing-start',
    'out-of-order',
    'oversized-total',
    'oversized-chunk',
    'shared-backing',
    'short-chunk',
    'incomplete-end',
    'wrong-end-count',
    'early-result',
    'result-path',
    'result-task',
    'result-environment',
    'raw-error',
    'oversized-title',
    'unexpected-field',
    'repeated-result',
    'crash-after-result',
    'missing-result',
  ])('rejects %s and cleans its output', async (mode) => {
    const { start, outputRoot, leases } = setup()
    const { child, running } = await start()
    if (mode === 'wrong-version') child.send({ type: 'screenshot-start', version: 2, bytes: 11 })
    if (mode === 'repeated-ready') child.ready()
    if (mode === 'missing-start') child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
    if (mode === 'out-of-order') {
      child.send({ type: 'screenshot-start', bytes: 11 })
      child.send({ type: 'screenshot-chunk', sequence: 1, data: png })
    }
    if (mode === 'oversized-total')
      child.send({ type: 'screenshot-start', bytes: maxWorkerScreenshotBytes + 1 })
    if (mode === 'oversized-chunk')
      child.send({
        type: 'screenshot-chunk',
        sequence: 0,
        data: new Uint8Array(maxWorkerScreenshotChunkBytes + 1),
      })
    if (mode === 'shared-backing')
      child.send({
        type: 'screenshot-chunk',
        sequence: 0,
        data: new Uint8Array(maxWorkerScreenshotBytes).subarray(0, 11),
      })
    if (mode === 'short-chunk') {
      child.send({ type: 'screenshot-start', bytes: 12 })
      child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
    }
    if (mode === 'incomplete-end') {
      child.send({ type: 'screenshot-start', bytes: 11 })
      child.send({ type: 'screenshot-end', bytes: 11, chunks: 1 })
    }
    if (mode === 'wrong-end-count') {
      child.send({ type: 'screenshot-start', bytes: 11 })
      child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
      await vi.waitFor(() => expect(child.sent.at(-1)?.type).toBe('chunk-ack'))
      child.send({ type: 'screenshot-end', bytes: 11, chunks: 2 })
    }
    if (mode === 'early-result') result(child)
    if (
      [
        'result-path',
        'result-task',
        'result-environment',
        'raw-error',
        'oversized-title',
        'repeated-result',
        'crash-after-result',
        'missing-result',
      ].includes(mode)
    ) {
      await screenshot(child)
      if (mode === 'result-path') result(child, { screenshotPath: '/outside' })
      if (mode === 'result-task') result(child, { taskId: 'other' })
      if (mode === 'result-environment') result(child, { environmentId: 'other' })
      if (mode === 'raw-error')
        result(child, {
          ok: false,
          errorCode: 'WORKER_ERROR',
          errorMessage: 'Authorization: private',
        })
      if (mode === 'oversized-title') result(child, { title: 'x'.repeat(4097) })
      if (mode === 'repeated-result') {
        result(child)
        result(child)
      }
      if (mode === 'crash-after-result') {
        result(child)
        child.exit(1)
      }
      if (mode === 'missing-result') child.exit(0)
    }
    if (mode === 'unexpected-field')
      child.send({ type: 'screenshot-start', bytes: 11, data: { token: 'private' } })
    expect(await running).toEqual({ ok: false, code: 'WORKER_FAILED', message: 'WORKER_FAILED' })
    expect(readdirSync(outputRoot)).toEqual([])
    expect(leases[0]?.revoke).toHaveBeenCalled()
  })
  it('does not treat a declared screenshot with a wrong PNG header as success', async () => {
    const { start, outputRoot } = setup()
    const { child, running } = await start()
    await screenshot(child, new Uint8Array(11))
    result(child)
    child.exit(0)
    expect(await running).toEqual({
      ok: false,
      code: 'WORKER_OUTPUT_FAILED',
      message: 'WORKER_OUTPUT_FAILED',
    })
    expect(readdirSync(outputRoot)).toEqual([])
  })
  it('ignores raw fatal diagnostic reports and waits for exit', async () => {
    const { start } = setup()
    const { child, running } = await start()
    child.emit('error', 'FatalError', '/secret/path', 'Authorization: private report')
    expect(await running).toEqual({ ok: false, code: 'WORKER_FAILED', message: 'WORKER_FAILED' })
  })
  it('revokes immediately on cancellation, retaining occupancy until real exit', async () => {
    const { start, service, outputRoot, leases } = setup()
    const { child, running } = await start()
    child.exitOnKill = false
    expect(service.cancel('task-test')).toEqual({ ok: true, data: true })
    expect(leases[0]?.revoke).toHaveBeenCalled()
    expect(await service.run(task('other'))).toEqual({
      ok: false,
      code: 'WORKER_BUSY',
      message: 'WORKER_BUSY',
    })
    child.exit(143)
    expect(await running).toEqual({ ok: false, code: 'CANCELLED', message: 'CANCELLED' })
    expect(readdirSync(outputRoot)).toEqual([])
    expect(service.cancel('task-test')).toEqual({ ok: true, data: false })
  })
  it('queues a pre-spawn stop, reports failure if still alive, and never releases an unconfirmed child', async () => {
    vi.useFakeTimers()
    const { service, created } = setup({ autoSpawn: false })
    const running = service.run(task())
    const child = created[0]!
    child.exitOnKill = false
    service.cancel('task-test')
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(workerStopGraceMs)
    expect(await running).toEqual({
      ok: false,
      code: 'WORKER_STOP_FAILED',
      message: 'WORKER_STOP_FAILED',
    })
    expect(await service.run(task('other'))).toEqual({
      ok: false,
      code: 'WORKER_BUSY',
      message: 'WORKER_BUSY',
    })
    child.start()
    expect(child.kill).toHaveBeenCalledTimes(1)
    child.exit(143)
    await vi.waitFor(() => expect(service.cancel('task-test')).toEqual({ ok: true, data: false }))
  })
  it('reports an unconfirmed OS exit without releasing the environment slot', async () => {
    vi.useFakeTimers()
    const { service, created, outputRoot } = setup({ autoSpawn: false })
    const running = service.run(task())
    const child = created[0]!
    child.start()
    child.ready()
    child.reaped = false
    child.exit(0)
    await vi.advanceTimersByTimeAsync(workerStopGraceMs)
    expect(await running).toEqual({
      ok: false,
      code: 'WORKER_STOP_FAILED',
      message: 'WORKER_STOP_FAILED',
    })
    expect(await service.run(task('other'))).toEqual({
      ok: false,
      code: 'WORKER_BUSY',
      message: 'WORKER_BUSY',
    })
    expect(readdirSync(outputRoot)).toHaveLength(1)
    child.reaped = true
    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(service.cancel('task-test')).toEqual({ ok: true, data: false }))
    expect(readdirSync(outputRoot)).toEqual([])
  })
  it('times out without extending the task budget', async () => {
    vi.useFakeTimers()
    const { service, created, outputRoot } = setup({ autoSpawn: false })
    const running = service.run(task())
    created[0]!.start()
    created[0]!.ready()
    await vi.advanceTimersByTimeAsync(6000)
    expect(await running).toEqual({ ok: false, code: 'WORKER_TIMEOUT', message: 'WORKER_TIMEOUT' })
    expect(readdirSync(outputRoot)).toEqual([])
  })
  it('drains an in-flight write after cancellation/exit before deleting files or releasing occupancy', async () => {
    let complete!: () => void
    const { start, service, outputRoot } = setup({
      allocate: (root) =>
        createWorkerOutput(
          root,
          (fd, bytes, offset) =>
            new Promise((resolve) => {
              complete = () => resolve(writeSync(fd, bytes, offset, bytes.byteLength - offset))
            }),
        ),
    })
    const { child, running } = await start()
    child.send({ type: 'screenshot-start', bytes: 11 })
    child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    service.cancel('task-test')
    await Promise.resolve()
    expect(await service.run(task('other'))).toEqual({
      ok: false,
      code: 'WORKER_BUSY',
      message: 'WORKER_BUSY',
    })
    expect(readdirSync(outputRoot)).toHaveLength(1)
    complete()
    expect(await running).toEqual({ ok: false, code: 'CANCELLED', message: 'CANCELLED' })
    expect(readdirSync(outputRoot)).toEqual([])
    expect(child.sent.some((message) => message.type === 'chunk-ack')).toBe(false)
  })
  it('rejects a second chunk while the first write is still pending', async () => {
    let complete!: () => void
    const { start } = setup({
      allocate: (root) =>
        createWorkerOutput(
          root,
          (fd, bytes, offset) =>
            new Promise((resolve) => {
              complete = () => resolve(writeSync(fd, bytes, offset, bytes.byteLength - offset))
            }),
        ),
    })
    const { child, running } = await start()
    child.send({ type: 'screenshot-start', bytes: 11 })
    child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
    child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    complete()
    expect(await running).toEqual({ ok: false, code: 'WORKER_FAILED', message: 'WORKER_FAILED' })
  })
  it('reports a sanitized write failure and does not ACK or retain partial output', async () => {
    const { start, outputRoot } = setup({
      allocate: (root) =>
        createWorkerOutput(root, async () => {
          throw new Error('ENOSPC private-path')
        }),
    })
    const { child, running } = await start()
    child.send({ type: 'screenshot-start', bytes: 11 })
    child.send({ type: 'screenshot-chunk', sequence: 0, data: png })
    expect(await running).toEqual({
      ok: false,
      code: 'WORKER_OUTPUT_FAILED',
      message: 'WORKER_OUTPUT_FAILED',
    })
    expect(child.sent.some((message) => message.type === 'chunk-ack')).toBe(false)
    expect(readdirSync(outputRoot)).toEqual([])
  })
  it('cancels environment tasks and drains them at application shutdown', async () => {
    const { start, service, outputRoot } = setup()
    const { running } = await start()
    service.cancelEnvironment('env-test')
    await service.shutdown()
    expect(await running).toEqual({ ok: false, code: 'CANCELLED', message: 'CANCELLED' })
    expect(readdirSync(outputRoot)).toEqual([])
  })
})
