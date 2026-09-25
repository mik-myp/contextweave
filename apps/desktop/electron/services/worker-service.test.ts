import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerService } from './worker-service'

const leaseControl = () => ({ access: { port: 9222, token: 'a'.repeat(64) }, revoke: vi.fn() })
const directories: string[] = []
const services: ReturnType<typeof createWorkerService>[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.shutdown()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'cw-worker-service-'))
  directories.push(directory)
  const workerPath = join(directory, 'fixture.cjs')
  const outputRoot = join(directory, 'results')
  // Exercises real OS descriptor inheritance, process exit, cancellation and stdout validation.
  writeFileSync(
    workerPath,
    `
    const fs = require('node:fs')
    let input = ''
    process.stdin.on('data', (chunk) => { input += chunk })
    process.stdin.on('end', () => {
      const payload = JSON.parse(input)
      const task = payload.task
      const mode = new URL(task.input.url).pathname
      if (mode === '/wait') { fs.writeFileSync(3, String(process.pid)); setInterval(() => {}, 1000); return }
      if (mode === '/flood') { process.stdout.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000); return }
      if (mode !== '/empty') fs.writeFileSync(3, Buffer.from('test screenshot'))
      const result = { protocolVersion: 1, taskId: task.taskId, environmentId: task.environmentId, ok: true, title: 'Fixture' }
      if (mode === '/path') result.screenshotPath = '/outside/protected.png'
      if (mode === '/mismatch') result.taskId = 'other-task'
      if (mode === '/environment-mismatch') result.environmentId = 'other-environment'
      if (mode === '/unicode') {
        result.title = 'A中文B'
        const bytes = Buffer.from(JSON.stringify(result) + '\\n')
        const split = bytes.indexOf(Buffer.from('中')) + 1
        process.stdout.write(bytes.subarray(0, split))
        setTimeout(() => process.stdout.write(bytes.subarray(split)), 25)
        return
      }
      if (mode === '/prefix') process.stdout.write('unexpected protocol output\\n')
      if (mode === '/malformed') { process.stdout.write('not-json'); return }
      if (mode === '/failed') { result.ok = false; result.errorCode = 'TEST_FAILED' }
      if (payload.outputDirectory || payload.screenshotPath || task.input.screenshotPath) process.exit(9)
      process.stdout.write(JSON.stringify(result) + '\\n')
      if (mode === '/crash') process.exitCode = 1
    })
  `,
  )
  const leases: ReturnType<typeof leaseControl>[] = []
  const acquire = vi.fn(() => {
    const lease = leaseControl()
    leases.push(lease)
    return lease
  })
  const service = createWorkerService(
    { session: (id) => (id === 'env-test' ? {} : undefined), leaseControl: acquire },
    workerPath,
    outputRoot,
  )
  services.push(service)
  return { service, outputRoot, directory, leases, acquire }
}
function task(taskId = 'task-test', mode = '/ok') {
  return {
    protocolVersion: 1,
    taskId,
    environmentId: 'env-test',
    kind: 'browser-smoke',
    input: { url: `https://example.invalid${mode}`, timeoutMs: 1000 },
  }
}

describe('worker service output boundary', () => {
  it('revokes private control leases on success, protocol failure and cancellation', async () => {
    const { service, leases, outputRoot } = setup()
    await service.run(task('one'))
    await service.run(task('two', '/mismatch'))
    const waiting = service.run(task('three', '/wait'))
    await vi.waitFor(() =>
      expect(
        readdirSync(outputRoot).some((name) =>
          readFileSync(join(outputRoot, name, 'screenshot.png'), 'utf8').match(/^\d+$/),
        ),
      ).toBe(true),
    )
    service.cancel('three')
    await waiting
    expect(leases).toHaveLength(3)
    for (const lease of leases) expect(lease.revoke).toHaveBeenCalled()
  })
  it('discards its owned output if the environment stops before a private lease is acquired', async () => {
    const { service, outputRoot, acquire } = setup()
    acquire.mockImplementation(() => {
      throw new Error('ENVIRONMENT_NOT_RUNNING')
    })
    expect(await service.run(task())).toMatchObject({ ok: false, code: 'WORKER_FAILED' })
    expect(readdirSync(outputRoot)).toEqual([])
  })
  it('returns only Main-owned screenshots and isolates repeated task IDs', async () => {
    const { service, outputRoot } = setup()
    const first = await service.run(task())
    const second = await service.run(task())
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('Expected successful tasks')
    expect(first.data.ok).toBe(true)
    expect(second.data.ok).toBe(true)
    const one = first.data.screenshotPath!
    const two = second.data.screenshotPath!
    expect(one).not.toBe(two)
    expect(readFileSync(one, 'utf8')).toBe('test screenshot')
    expect(readFileSync(two, 'utf8')).toBe('test screenshot')
    expect(readdirSync(outputRoot)).toHaveLength(2)
  })

  it('preserves multibyte text split across separate stdout chunks', async () => {
    const { service } = setup()
    const result = await service.run(task('unicode-task', '/unicode'))
    expect(result).toMatchObject({ ok: true, data: { ok: true, title: 'A中文B' } })
  })

  it.each(['../escape', '..\\escape', '/outside', 'C:\\outside', 'x'.repeat(129)])(
    'rejects task ID %j before allocating or spawning',
    async (id) => {
      const { service, outputRoot } = setup()
      await expect(service.run(task(id))).rejects.toThrow()
      expect(existsSync(outputRoot)).toBe(false)
    },
  )

  it('rejects caller-supplied paths and output directories before allocating', async () => {
    const { service, outputRoot } = setup()
    await expect(
      service.run({ ...task(), input: { ...task().input, screenshotPath: '/outside' } }),
    ).rejects.toThrow()
    await expect(service.run({ ...task(), outputDirectory: '/outside' })).rejects.toThrow()
    expect(existsSync(outputRoot)).toBe(false)
  })

  it.each([
    '/path',
    '/mismatch',
    '/environment-mismatch',
    '/malformed',
    '/prefix',
    '/empty',
    '/crash',
  ])('rejects invalid process results and discards its output: %s', async (mode) => {
    const { service, outputRoot } = setup()
    expect(await service.run(task('task-test', mode))).toMatchObject({
      ok: false,
      code: 'WORKER_FAILED',
    })
    expect(readdirSync(outputRoot)).toEqual([])
  })

  it('discards failed task output even when the process returns a valid envelope', async () => {
    const { service, outputRoot } = setup()
    expect(await service.run(task('task-test', '/failed'))).toMatchObject({
      ok: true,
      data: { ok: false, errorCode: 'TEST_FAILED' },
    })
    expect(readdirSync(outputRoot)).toEqual([])
  })

  it('cancels a running task, cleans its output, and keeps one task per environment', async () => {
    const { service, outputRoot } = setup()
    const running = service.run(task('task-wait', '/wait'))
    expect(await service.run(task('task-other'))).toMatchObject({ ok: false, code: 'WORKER_BUSY' })
    let childPid = 0
    await vi.waitFor(() => {
      childPid = Number(
        readFileSync(join(outputRoot, readdirSync(outputRoot)[0]!, 'screenshot.png'), 'utf8'),
      )
      expect(childPid).toBeGreaterThan(0)
    })
    expect(service.cancel('task-wait')).toEqual({ ok: true, data: true })
    expect(await service.run(task('task-other'))).toMatchObject({ ok: false, code: 'WORKER_BUSY' })
    expect(await running).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(() => process.kill(childPid, 0)).toThrow()
    expect(readdirSync(outputRoot)).toEqual([])
    expect(service.cancel('task-wait')).toEqual({ ok: true, data: false })
  })

  it('terminates a process that exceeds the stdout limit before discarding output', async () => {
    const { service, outputRoot } = setup()
    expect(await service.run(task('task-flood', '/flood'))).toMatchObject({
      ok: false,
      code: 'WORKER_OUTPUT_LIMIT',
    })
    expect(readdirSync(outputRoot)).toEqual([])
  })

  it('times out and removes unfinished output', async () => {
    const { service, outputRoot } = setup()
    expect(await service.run(task('task-wait', '/wait'))).toMatchObject({
      ok: false,
      code: 'WORKER_TIMEOUT',
    })
    expect(readdirSync(outputRoot)).toEqual([])
  }, 15000)

  it('fails without creating output for an environment that is not running', async () => {
    const { service, outputRoot } = setup()
    expect(await service.run({ ...task(), environmentId: 'not-running' })).toMatchObject({
      ok: false,
      code: 'ENVIRONMENT_NOT_RUNNING',
    })
    expect(existsSync(outputRoot)).toBe(false)
  })

  it('cleans output after a process fails to run the worker entry', async () => {
    const { directory, outputRoot } = setup()
    const service = createWorkerService(
      { session: () => ({}), leaseControl },
      join(directory, 'missing.cjs'),
      outputRoot,
    )
    services.push(service)
    expect(await service.run(task())).toMatchObject({ ok: false, code: 'WORKER_FAILED' })
    expect(readdirSync(outputRoot)).toEqual([])
  })
})
