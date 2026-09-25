import { createIpLocaleService, parseIpLocale } from './ip-locale'
import { ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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
import { createRuntimeSupervisor, terminateChild } from './runtime-supervisor'
import { createKernelService } from './kernel-service'
import { createCommandCoordinator } from './command-coordinator'
import { ok } from './result'
// Fake ChildProcess objects use this test process PID. They must not invoke slow OS
// probe subprocesses; real identity capture is verified by the platform smoke tests.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (file: string) => {
      if (file === '/bin/ps') return 'Fri Sep 25 12:34:56 2026\n'
      if (file.endsWith('powershell.exe')) return '123456789\n'
      throw new Error('Unexpected synchronous command in runtime unit test')
    },
  }
})
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean()
})
function fixture(
  kernelVersion = 'local',
  automatic = false,
  proxyType?: 'http' | 'https' | 'socks5',
) {
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
      commonConfig: {
        language: automatic ? 'auto' : 'system',
        timezone: automatic ? 'auto' : 'system',
      },
      proxy: proxyType ? { type: proxyType, host: 'proxy.example.invalid', port: 1080 } : undefined,
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
    // Ordinary stop tests should model Browser.close, not spend three seconds
    // waiting for a synthetic process that cannot receive a real CDP command.
    close: vi.fn(async () => {
      Object.defineProperty(child, 'exitCode', { value: 0, configurable: true })
      queueMicrotask(() => child.emit('exit', 0, null))
    }),
  }
  const locale = createIpLocaleService()
  const detect = vi.spyOn(locale, 'detect').mockResolvedValue(
    parseIpLocale(
      JSON.stringify({
        success: true,
        ip: '203.0.113.1',
        country_code: 'JP',
        timezone: { id: 'Asia/Tokyo' },
      }),
      proxyType ? 'proxy' : 'direct',
    ),
  )
  const runtime = createRuntimeSupervisor({
    locale,
    repository,
    kernels,
    credentials: { cleanupTemporaryFiles: vi.fn(), save: vi.fn(), remove: vi.fn(), read: vi.fn() },
    preflight,
    changed: vi.fn(),
    driver,
  })
  cleanup.push(async () => {
    // Drain exit handlers and transport cleanup before closing the test database, even
    // when an assertion failed while a synthetic child was still marked running.
    if (child.exitCode === null) {
      Object.defineProperty(child, 'exitCode', { value: 0, configurable: true })
      child.emit('exit', 0, null)
    }
    await runtime.shutdown()
  })
  return { dir, repository, child, runtime, driver, preflight, detect, kernels }
}
describe('runtime supervisor', () => {
  it('preserves corrupt preferences, reports the specific error, and never spawns a browser', async () => {
    const f = fixture()
    mkdirSync(join(f.dir, 'Default'))
    const path = join(f.dir, 'Default', 'Preferences')
    const original = '{"private":"fixture-secret"'
    writeFileSync(path, original)
    expect(await f.runtime.start('env-a')).toMatchObject({
      ok: false,
      code: 'BROWSER_PREFERENCES_INVALID',
    })
    expect(f.driver.launch).not.toHaveBeenCalled()
    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
    expect(f.repository.get('env-a')?.status).toBe('error')
  })
  it('does not use the network for existing system/manual settings', async () => {
    const f = fixture()
    expect((await f.runtime.start('env-a')).ok).toBe(true)
    expect(f.detect).not.toHaveBeenCalled()
    await f.runtime.stop('env-a')
  })
  it.each([undefined, 'http', 'https', 'socks5'] as const)(
    'resolves automatic settings before launch through %s, retaining the stored choice',
    async (type) => {
      const f = fixture('local', true, type)
      expect((await f.runtime.start('env-a')).ok).toBe(true)
      const configuration = vi.mocked(f.kernels.buildLaunchPlan).mock.calls[0]![1]
      expect(configuration.commonConfig).toMatchObject({
        language: 'ja-JP',
        timezone: 'Asia/Tokyo',
      })
      expect(f.driver.settings).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ language: 'ja-JP', timezone: 'Asia/Tokyo' }),
        expect.any(Function),
        type ? expect.objectContaining({ host: '127.0.0.1' }) : undefined,
        expect.any(Function),
        expect.any(AbortSignal),
      )
      expect(f.detect).toHaveBeenCalledWith(
        type
          ? expect.objectContaining({
              host: '127.0.0.1',
              username: expect.any(String),
              password: expect.any(String),
            })
          : undefined,
        expect.any(AbortSignal),
      )
      expect(JSON.parse(f.repository.get('env-a')!.configJson).commonConfig).toMatchObject({
        language: 'auto',
        timezone: 'auto',
      })
      await f.runtime.stop('env-a')
    },
  )
  it('fails before spawning and releases the profile lock when detection fails', async () => {
    const f = fixture('local', true)
    f.detect.mockRejectedValue(new Error('IP_LOCALE_RATE_LIMITED'))
    expect(await f.runtime.start('env-a')).toMatchObject({
      ok: false,
      code: 'IP_LOCALE_RATE_LIMITED',
    })
    expect(f.driver.launch).not.toHaveBeenCalled()
    expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
    expect(f.repository.get('env-a')!.status).toBe('error')
  })
  it('aborts detection before launch when the environment start is cancelled', async () => {
    const f = fixture('local', true)
    f.detect.mockImplementation(
      (_proxy, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true })
        }),
    )
    const starting = f.runtime.start('env-a')
    await vi.waitFor(() => expect(f.detect).toHaveBeenCalled())
    f.runtime.cancelStart('env-a')
    expect(await starting).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(f.driver.launch).not.toHaveBeenCalled()
    expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
  })
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
  it('recovers a saved reused PID without sending a termination signal', async () => {
    const f = fixture()
    const startedAt = new Date().toISOString()
    acquireRuntimeLock(f.dir, {
      pid: process.pid,
      processIdentity: 'previous-instance',
      sessionId: 'old',
      controlPort: 9000,
      startedAt,
    })
    f.repository.createRuntimeSession({
      pid: process.pid,
      processIdentity: 'previous-instance',
      sessionId: 'old',
      environmentId: 'env-a',
      controlPort: 9000,
      startedAt,
      status: 'running',
      exitReason: null,
    })
    const kill = vi.spyOn(process, 'kill')
    try {
      f.runtime.recoverOnStartup()
      expect(await f.runtime.recover('env-a')).toMatchObject({ ok: true })
      expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
      expect(f.repository.getRuntimeSession('old')?.status).toBe('crashed')
      expect(kill.mock.calls.every((call) => call[1] === 0)).toBe(true)
    } finally {
      kill.mockRestore()
    }
  })
  it('falls back to terminating its own child if the graceful close command fails', async () => {
    const f = fixture()
    await f.runtime.start('env-a')
    f.driver.close.mockRejectedValue(new Error('fixture close failed'))
    vi.useFakeTimers()
    try {
      const stopped = f.runtime.stop('env-a')
      await vi.advanceTimersByTimeAsync(3000)
      expect(await stopped).toMatchObject({ ok: true })
      expect(f.child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('retains the lock and kernel lease on stop timeout, then retries without spawning another process', async () => {
    const f = fixture()
    const release = vi.fn()
    vi.spyOn(f.kernels, 'retain').mockReturnValue(release)
    await f.runtime.start('env-a')
    vi.mocked(f.child.kill).mockReturnValue(false)
    f.driver.close.mockResolvedValue(undefined)
    vi.useFakeTimers()
    try {
      const stopped = f.runtime.stop('env-a')
      await vi.advanceTimersByTimeAsync(9000)
      expect(await stopped).toMatchObject({ ok: false, code: 'STOP_TIMEOUT' })
      expect(existsSync(runtimeLockPath(f.dir))).toBe(true)
      expect(release).not.toHaveBeenCalled()
      expect(f.repository.get('env-a')?.status).toBe('needs-recovery')
      Object.defineProperty(f.child, 'exitCode', { value: 0, configurable: true })
      f.child.emit('exit', 0, null)
      expect(await f.runtime.stop('env-a')).toMatchObject({ ok: true })
      expect(release).toHaveBeenCalled()
      expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('cancels configuration on shutdown and waits for startup cleanup before returning', async () => {
    const f = fixture()
    f.driver.settings.mockImplementation(
      (_port, _settings, _failure, _proxy, _pages, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    )
    const started = f.runtime.start('env-a')
    await vi.waitFor(() => expect(f.driver.settings).toHaveBeenCalled())
    await f.runtime.shutdown()
    expect(await started).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(existsSync(runtimeLockPath(f.dir))).toBe(false)
    expect(await f.runtime.start('env-a')).toMatchObject({ ok: false, code: 'CANCELLED' })
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

it('never signals a child PID when its saved OS start identity no longer matches', () => {
  const child = new ChildProcess()
  Object.defineProperty(child, 'pid', { value: process.pid })
  child.kill = vi.fn(() => true)
  terminateChild(child, 'SIGTERM', 'previous-instance')
  expect(child.kill).not.toHaveBeenCalled()
})
