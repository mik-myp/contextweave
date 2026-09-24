import { ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  environmentConfigSchema,
  type IpcResult,
  type PreflightReport,
} from '@contextweave/contracts'
import {
  openLocalDatabase,
  EnvironmentRepository,
  acquireRuntimeLock,
  runtimeLockPath,
} from '@contextweave/storage'
import type { connectBrowserSettings } from '../browser-settings'
import { createRuntimeSupervisor } from './runtime-supervisor'
import { createKernelService } from './kernel-service'
import { createCommandCoordinator } from './command-coordinator'
import { ok } from './result'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanup.splice(0).reverse()) clean()
})
function fixture(kernelVersion = 'local') {
  const root = mkdtempSync(join(tmpdir(), 'cw-supervisor-')),
    dir = join(root, 'env-a')
  mkdirSync(dir)
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  cleanup.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const repository = new EnvironmentRepository(db.sqlite)
  repository.create({
    config: environmentConfigSchema.parse({
      environmentId: 'env-a',
      name: 'A',
      kernelId: 'standard-chromium',
      kernelVersion,
      commonConfig: { language: 'system', timezone: 'system' },
    }),
    dataDir: dir,
    platform: 'darwin',
    arch: 'arm64',
  })
  const child = new ChildProcess()
  Object.defineProperty(child, 'pid', { value: process.pid })
  child.kill = vi.fn(() => {
    Object.defineProperty(child, 'exitCode', { value: 0, configurable: true })
    queueMicrotask(() => child.emit('exit', 0, null))
    return true
  })
  const kernels = createKernelService(repository, 'darwin', 'arm64')
  vi.spyOn(kernels, 'buildLaunchPlan').mockReturnValue({
    executablePath: 'fixture',
    args: [],
    userDataDir: dir,
    controlPort: 9000,
  })
  const preflight = vi.fn<() => Promise<PreflightReport>>().mockResolvedValue({
    environmentId: 'env-a',
    revision: 1,
    checkedAt: new Date().toISOString(),
    canStart: true,
    issues: [],
    executableVersion: '123.0.0.1',
  })
  const driver = {
    launch: vi.fn(() => child),
    ready: vi
      .fn<(port: number, signal: AbortSignal) => Promise<string | undefined>>()
      .mockResolvedValue('Chrome/123.0.0.1'),
    settings: vi.fn<typeof connectBrowserSettings>(async () => () => {}),
  }
  const runtime = createRuntimeSupervisor({
    repository,
    kernels,
    credentials: { cleanupTemporaryFiles: vi.fn(), save: vi.fn(), remove: vi.fn(), read: vi.fn() },
    preflight,
    changed: vi.fn(),
    driver,
  })
  return { dir, repository, child, runtime, driver, preflight }
}
describe('runtime supervisor', () => {
  it('rejects a binary whose CDP version differs from the pinned package', async () => {
    const { runtime, driver, child, repository, dir } = fixture('148.0.7778.215')
    expect(await runtime.start('env-a')).toMatchObject({
      ok: false,
      code: 'KERNEL_VERSION_MISMATCH',
    })
    expect(driver.settings).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalled()
    expect(repository.get('env-a')?.status).not.toBe('running')
    expect(existsSync(runtimeLockPath(dir))).toBe(false)
  })
  it('drains unscoped installation commands before shutdown and records cancellation', async () => {
    const { repository } = fixture()
    const commands = createCommandCoordinator(repository, vi.fn())
    let finish!: () => void
    const command = commands.run(
      'install',
      null,
      () =>
        new Promise<IpcResult<boolean>>((resolve) => {
          finish = () => resolve({ ok: false, code: 'CANCELLED', message: 'CANCELLED' })
        }),
    )
    let drained = false
    const drain = commands.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    finish()
    await Promise.all([command, drain])
    expect(drained).toBe(true)
    expect(repository.listOperations()[0]?.status).toBe('cancelled')
  })
  it('allows one launch, records its revision/version and stops without losing the directory', async () => {
    const { runtime, driver, repository, dir } = fixture()
    const [first, duplicate] = await Promise.all([runtime.start('env-a'), runtime.start('env-a')])
    expect(first.ok).toBe(true)
    expect(duplicate).toMatchObject({ ok: false, code: 'ALREADY_RUNNING' })
    expect(driver.launch).toHaveBeenCalledTimes(1)
    expect(repository.listRuntimeSessions()[0]).toMatchObject({
      revision: 1,
      executableVersion: '123.0.0.1',
      status: 'running',
    })
    expect((await runtime.stop('env-a')).ok).toBe(true)
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(runtimeLockPath(dir))).toBe(false)
    expect(repository.listRuntimeSessions()[0]?.endedAt).toBeTruthy()
  })
  it('treats CDP disconnect followed by a normal browser exit as stopped rather than crashed', async () => {
    const { runtime, driver, child, repository, dir } = fixture()
    expect((await runtime.start('env-a')).ok).toBe(true)
    driver.settings.mock.calls[0][2]?.(new Error('CDP_DISCONNECTED'))
    expect(repository.get('env-a')?.status).toBe('running')
    Object.defineProperty(child, 'exitCode', { value: 0, configurable: true })
    child.emit('exit', 0, null)
    await Promise.resolve()
    expect(repository.get('env-a')?.status).toBe('stopped')
    expect(repository.listRuntimeSessions()[0]).toMatchObject({
      status: 'stopped',
      exitReason: 'BROWSER_CLOSED',
    })
    expect(child.kill).not.toHaveBeenCalled()
    expect(existsSync(runtimeLockPath(dir))).toBe(false)
  })
  it('automatically stops after the last browser page closes and records its actual cause', async () => {
    const { runtime, driver, child, repository, dir } = fixture()
    expect((await runtime.start('env-a')).ok).toBe(true)
    driver.settings.mock.calls[0][4]?.()
    expect(repository.get('env-a')?.status).toBe('stopping')
    // Model the process exiting in response to Browser.close while stop owns cleanup.
    child.kill()
    expect((await runtime.stop('env-a')).ok).toBe(true)
    expect(repository.listRuntimeSessions()[0]).toMatchObject({
      status: 'stopped',
      exitReason: 'BROWSER_CLOSED',
    })
    expect(repository.get('env-a')?.status).toBe('stopped')
    expect(existsSync(runtimeLockPath(dir))).toBe(false)
  })
  it('cancels during startup and releases ownership only after the child exits', async () => {
    const { runtime, driver, repository, dir } = fixture()
    driver.ready.mockImplementation(
      (_port, signal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled'))),
        ),
    )
    const start = runtime.start('env-a')
    await vi.waitFor(() => expect(driver.ready).toHaveBeenCalled())
    runtime.cancelStart('env-a')
    expect(await start).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(repository.get('env-a')?.status).toBe('stopped')
    expect(existsSync(runtimeLockPath(dir))).toBe(false)
  })
  it('fails immediately when the browser exits before its control connection is ready', async () => {
    const { runtime, driver, child, dir } = fixture()
    driver.ready.mockImplementation(
      (_port, signal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('exited')), { once: true }),
        ),
    )
    const start = runtime.start('env-a')
    await vi.waitFor(() => expect(driver.ready).toHaveBeenCalled())
    Object.defineProperty(child, 'exitCode', { value: 1, configurable: true })
    child.emit('exit', 1, null)
    expect(await start).toMatchObject({ ok: false, code: 'START_FAILED' })
    expect(existsSync(runtimeLockPath(dir))).toBe(false)
  })
  it('does not launch when preflight fails', async () => {
    const { runtime, driver, preflight } = fixture()
    preflight.mockResolvedValue({
      environmentId: 'env-a',
      revision: 1,
      checkedAt: new Date().toISOString(),
      canStart: false,
      issues: [{ code: 'CREDENTIAL_UNAVAILABLE', severity: 'error' }],
    })
    expect(await runtime.start('env-a')).toMatchObject({
      ok: false,
      code: 'CREDENTIAL_UNAVAILABLE',
    })
    expect(driver.launch).not.toHaveBeenCalled()
  })
  it('marks an unexpected exit for recovery and does not kill a reused/live saved PID', async () => {
    const { runtime, child, repository, dir } = fixture()
    await runtime.start('env-a')
    Object.defineProperty(child, 'exitCode', { value: 1, configurable: true })
    child.emit('exit', 1, null)
    expect(repository.get('env-a')?.status).toBe('needs-recovery')
    expect((await runtime.recover('env-a')).ok).toBe(true)
    acquireRuntimeLock(dir, {
      pid: process.pid,
      sessionId: 'old',
      controlPort: 9000,
      startedAt: new Date().toISOString(),
    })
    const kill = vi.spyOn(process, 'kill')
    expect(await runtime.recover('env-a')).toMatchObject({
      ok: false,
      code: 'RECOVERY_MANUAL_REQUIRED',
    })
    expect(kill.mock.calls.every((call) => call[1] === 0)).toBe(true)
    kill.mockRestore()
  })
  it('serializes commands for one environment and records failures without swallowing them', async () => {
    const { repository } = fixture(),
      commands = createCommandCoordinator(repository, vi.fn())
    let finish!: () => void
    const pending = commands.run<boolean>(
      'start',
      'env-a',
      () =>
        new Promise<IpcResult<boolean>>((resolve) => {
          finish = () => resolve(ok(true))
        }),
    )
    expect(await commands.run('update', 'env-a', () => ok(true))).toMatchObject({
      ok: false,
      code: 'OPERATION_IN_PROGRESS',
    })
    finish()
    await pending
    expect(repository.listOperations()[0]?.status).toBe('succeeded')
    await commands.run('update', 'env-a', () => {
      throw new Error('CONFIG_CONFLICT')
    })
    expect(
      repository.listOperations().some((operation) => operation.errorCode === 'CONFIG_CONFLICT'),
    ).toBe(true)
  })
})
