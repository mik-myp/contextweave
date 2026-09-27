import {
  mkdtempSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactRepository, EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { environmentConfigSchema, maxArtifactBytes } from '@contextweave/contracts'
import type { WorkerTask } from '@contextweave/worker-protocol'
import { createArtifactService } from './artifacts'
import { createWorkerOutput } from './worker-output'
const task: WorkerTask = {
  protocolVersion: 1,
  taskId: 'repeatable',
  environmentId: 'env',
  kind: 'browser-smoke',
  input: { url: 'http://127.0.0.1/', timeoutMs: 1000 },
}
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const clean of cleanups.splice(0).reverse()) await clean()
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cw-artifact-budget-service-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'data.sqlite'),
    db = openLocalDatabase(file),
    runtime = openLocalDatabase(file)
  cleanups.push(() => {
    if (db.sqlite.isOpen) db.close()
    if (runtime.sqlite.isOpen) runtime.close()
  })
  const env = new EnvironmentRepository(runtime.sqlite)
  env.create({
    config: environmentConfigSchema.parse({
      environmentId: 'env',
      name: 'Budget fixture',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
    }),
    dataDir: '/fixture/profile',
    platform: 'darwin',
    arch: 'arm64',
  })
  const repo = new ArtifactRepository(db.sqlite),
    outputRoot = join(root, 'results')
  const allocate = vi.fn(createWorkerOutput),
    changed = vi.fn()
  const service = createArtifactService(repo, changed, outputRoot, allocate)
  function output() {
    const result = service.allocate(task)
    if (!result.ok) throw new Error(result.code)
    cleanups.push(() => result.output.close())
    return result.output
  }
  return { root, file, db, runtime, env, repo, outputRoot, allocate, changed, service, output }
}
it('rejects over-budget tasks before allocating and never releases a maximum charge before successful cleanup', async () => {
  const f = setup()
  f.service.updateBudget({ limitMiB: 32, expectedRevision: 1 })
  const output = f.output()
  expect(f.repo.budget().reserved.bytes).toBe(maxArtifactBytes)
  expect(f.service.allocate(task)).toEqual({ ok: false, code: 'ARTIFACT_BUDGET_EXCEEDED' })
  expect(f.allocate).toHaveBeenCalledTimes(1)
  expect(readdirSync(f.outputRoot)).toHaveLength(1)
  await output.append(png)
  await f.service.discard(output)
  expect(f.repo.budget().reserved.bytes).toBe(0)
  expect(readdirSync(f.outputRoot)).toEqual([])
  const another = f.output()
  expect(another.artifactId).not.toBe(output.artifactId)
})
it('binds empty original ownership before writing and charges successful registration atomically', async () => {
  const f = setup(),
    output = f.output()
  expect(f.repo.budget().reserved.count).toBe(1)
  expect(
    f.db.sqlite.prepare('SELECT allocation_name FROM screenshot_reservations').get()
      ?.allocation_name,
  ).toBe(output.allocation().allocationName)
  await output.append(png)
  expect(() => output.allocation()).toThrow('WORKER_OUTPUT_INVALID')
  await output.close()
  expect(f.service.register(task, output).ok).toBe(true)
  expect(f.repo.budget()).toMatchObject({
    registered: { count: 1, bytes: png.length },
    reserved: { count: 0, bytes: 0 },
  })
})
it.each(['reserve', 'bind'] as const)(
  'retains an unconfirmed %s without allowing a Worker allocation to proceed',
  async (phase) => {
    const f = setup()
    const method = phase === 'reserve' ? 'reserve' : 'bindAllocation'
    // Each method has a different schema; spy the independently typed branch instead of casting.
    if (method === 'reserve') {
      const reserve = f.repo.reserve.bind(f.repo)
      vi.spyOn(f.repo, 'reserve').mockImplementation((value) => {
        reserve(value)
        throw new Error('private commit uncertainty')
      })
    } else {
      const bind = f.repo.bindAllocation.bind(f.repo)
      vi.spyOn(f.repo, 'bindAllocation').mockImplementation((value) => {
        bind(value)
        throw new Error('private bind uncertainty')
      })
    }
    const result = f.service.allocate(task)
    expect(result).toMatchObject({ ok: false, code: 'WORKER_OUTPUT_RESERVATION_UNCONFIRMED' })
    if (result.ok) throw new Error('Unexpected admission')
    await result.output?.close()
    expect(f.repo.budget().reserved.count).toBe(1)
    expect(f.allocate).toHaveBeenCalledTimes(phase === 'reserve' ? 0 : 1)
    expect(f.repo.budget().registered.count).toBe(0)
  },
)
it('retains the maximum charge when original paths were replaced instead of deleting an unrelated file', async () => {
  const f = setup(),
    output = f.output()
  await output.append(png)
  await output.close()
  renameSync(f.outputRoot, join(f.root, 'original'))
  mkdirSync(output.directory, { recursive: true })
  writeFileSync(output.screenshotPath, 'unrelated: retain')
  await expect(f.service.discard(output)).rejects.toThrow('WORKER_OUTPUT_CLEANUP_FAILED')
  expect(readFileSync(output.screenshotPath, 'utf8')).toBe('unrelated: retain')
  expect(f.repo.budget().reserved.bytes).toBe(maxArtifactBytes)
})
it.each([false, true])(
  'retains a complete file and reconciles uncertain registration after restart (committed: %s)',
  async (committed) => {
    const f = setup(),
      output = f.output()
    await output.append(png)
    await output.close()
    const exec = f.db.sqlite.exec.bind(f.db.sqlite)
    vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT') {
        if (committed) exec(sql)
        throw new Error('private disk failure')
      }
      if (sql === 'ROLLBACK') throw new Error('private rollback failure')
      return exec(sql)
    })
    expect(f.service.register(task, output)).toEqual({
      ok: false,
      code: 'WORKER_OUTPUT_REGISTRATION_UNCONFIRMED',
      preserve: true,
    })
    expect(existsSync(output.screenshotPath)).toBe(true)
    f.env.updateStatus('env', 'stopped')
    expect(f.env.get('env')?.status).toBe('stopped')
    const reopened = openLocalDatabase(f.file)
    try {
      expect(new ArtifactRepository(reopened.sqlite).budget()).toMatchObject({
        registered: { count: committed ? 1 : 0 },
        reserved: { count: committed ? 0 : 1 },
      })
    } finally {
      reopened.close()
    }
  },
)
it('retains accounting after file deletion if releasing its reservation cannot commit', async () => {
  const f = setup(),
    output = f.output()
  await output.append(png)
  const exec = f.db.sqlite.exec.bind(f.db.sqlite)
  vi.spyOn(f.db.sqlite, 'exec').mockImplementation((sql) => {
    if (sql === 'COMMIT') throw new Error('disk full')
    return exec(sql)
  })
  await expect(f.service.discard(output)).rejects.toThrow('disk full')
  expect(existsSync(output.directory)).toBe(false)
  expect(f.repo.budget().reserved.count).toBe(1)
})

it('does not release a committed maximum reservation when filesystem allocation fails before binding', () => {
  const f = setup()
  f.allocate.mockImplementation(() => {
    throw new Error('ENOSPC private allocation path')
  })
  expect(f.service.allocate(task)).toMatchObject({
    ok: false,
    code: 'WORKER_OUTPUT_RESERVATION_UNCONFIRMED',
  })
  expect(existsSync(f.outputRoot)).toBe(false)
  expect(f.repo.budget()).toMatchObject({
    registered: { count: 0, bytes: 0 },
    reserved: { count: 1, bytes: maxArtifactBytes },
  })
  expect(
    f.db.sqlite.prepare('SELECT allocation_name FROM screenshot_reservations').get()
      ?.allocation_name,
  ).toBeNull()
})
