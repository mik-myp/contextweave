import { createStartupBudget, confirmProcessIdentity } from './runtime-startup'
import { applyIpLocale, type IpLocaleService } from './ip-locale'
import { openProxyTransport, type ProxyTransport } from './proxy-transport'
import { createBrowserControl, type BrowserControl } from './browser-control'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  environmentConfigSchema,
  type EnvironmentSummary,
  type IpcResult,
  type PreflightReport,
} from '@contextweave/contracts'
import {
  acquireRuntimeLock,
  inspectRuntimeLock,
  isRuntimeProcessAlive,
  readProcessIdentityAsync,
  releaseRuntimeLock,
  updateRuntimeLockOwner,
  type EnvironmentRepository,
} from '@contextweave/storage'
import type { LaunchPlan } from '@contextweave/kernel-core'
import { prepareBrowserProfile, connectBrowserSettings } from '../browser-settings'
import { resolveEnvironmentProxy } from '../environment-management'
import type { KernelService } from './kernel-service'
import type { CredentialStore } from './credentials'
import { ok, fail, toSummary } from './result'

type Session = {
  child: ChildProcess
  control: BrowserControl
  sessionId: string
  dataDir: string
  stopReason?: 'USER_STOPPED' | 'BROWSER_CLOSED'
  stopRequested: boolean
  startFailed: boolean
  processIdentity?: string
  releaseKernel: () => void
  closeProxy?: () => Promise<void>
  closeSettings?: () => void
}
type RuntimeDriver = {
  identity: typeof readProcessIdentityAsync
  openControl(): Promise<BrowserControl>
  launch(plan: LaunchPlan): ChildProcess
  ready(
    control: BrowserControl,
    signal: AbortSignal,
    deadline?: number,
  ): Promise<string | undefined>
  settings: typeof connectBrowserSettings
  close?: (control: BrowserControl) => Promise<void>
}
export function isChildRunning(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null
}
export function terminateChild(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
  processIdentity?: string,
) {
  if (processIdentity && child.pid && !isRuntimeProcessAlive(child.pid, processIdentity)) return
  if (isChildRunning(child)) {
    try {
      child.kill(signal)
    } catch {
      /* The exit/recovery path retains ownership until confirmed. */
    }
  }
}
export async function waitForChildExit(child: ChildProcess, timeoutMs = 3000): Promise<boolean> {
  if (!isChildRunning(child)) return true
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(!isChildRunning(child))
    }, timeoutMs)
    child.once('exit', onExit)
  })
}
const defaultDriver: RuntimeDriver = {
  identity: readProcessIdentityAsync,
  openControl: createBrowserControl,
  launch: (plan) =>
    spawn(plan.executablePath, plan.args, {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: false,
    }),
  ready: (control, signal, deadline) => control.ready(signal, deadline),
  settings: connectBrowserSettings,
  close: (control) => control.closeBrowser(),
}

export function createRuntimeSupervisor(options: {
  repository: EnvironmentRepository
  kernels: KernelService
  credentials: CredentialStore
  preflight(id: string): Promise<PreflightReport>
  changed(): void
  locale?: IpLocaleService
  driver?: RuntimeDriver
}) {
  const { repository, kernels, credentials, preflight, changed } = options
  const driver = options.driver ?? defaultDriver
  const sessions = new Map<string, Session>()
  const starting = new Map<string, AbortController>()
  let shuttingDown = false
  const startTasks = new Set<Promise<IpcResult<EnvironmentSummary>>>()
  const stopping = new Map<string, Promise<IpcResult<EnvironmentSummary>>>()
  function recoverOnStartup() {
    repository.recoverOperations()
    for (const record of repository.listAll()) {
      const previous = repository
        .listRuntimeSessions()
        .filter(
          (session) =>
            session.environmentId === record.environmentId &&
            ['starting', 'running', 'stopping'].includes(session.status),
        )
      const lock = inspectRuntimeLock(record.dataDir)
      if (
        !previous.length &&
        !existsSync(lock.lockPath) &&
        !['starting', 'running', 'stopping'].includes(record.status)
      )
        continue
      // A PID is insufficient evidence to kill/adopt a process, even with a matching old lock.
      for (const session of previous)
        if (!isRuntimeProcessAlive(session.pid, session.processIdentity))
          repository.updateRuntimeSession(session.sessionId, 'crashed', 'CLIENT_INTERRUPTED')
      repository.updateStatus(record.environmentId, 'needs-recovery')
    }
  }
  async function startImpl(
    id: string,
    phase: (value: string) => void = () => {},
  ): Promise<IpcResult<EnvironmentSummary>> {
    // Automatic last-window shutdown can still be releasing resources after the exit event.
    const pendingStop = stopping.get(id)
    if (pendingStop) await pendingStop
    if (shuttingDown) return fail('CANCELLED')
    if (starting.has(id) || sessions.has(id)) return fail('ALREADY_RUNNING')
    const controller = new AbortController()
    starting.set(id, controller)
    let managed: Session | undefined
    let budget: ReturnType<typeof createStartupBudget> | undefined
    let control: BrowserControl | undefined
    let transport: ProxyTransport | undefined
    let releaseKernel: (() => void) | undefined
    let locked = false
    const sessionId = `session-${randomUUID()}`
    const record = repository.get(id)
    if (!record) {
      starting.delete(id)
      return fail('NOT_FOUND')
    }
    try {
      releaseKernel = kernels.retain(record.kernelId)
      phase('preflight')
      const report = await preflight(id)
      controller.signal.throwIfAborted()
      if (!report.canStart)
        return fail(
          report.issues.find((issue) => issue.severity === 'error')?.code ?? 'PREFLIGHT_FAILED',
        )
      const config = resolveEnvironmentProxy(
        repository,
        environmentConfigSchema.parse(JSON.parse(record.configJson)),
      )
      control = await driver.openControl()
      const port = control.port
      controller.signal.throwIfAborted()
      const ownerIdentity = await driver.identity(process.pid, controller.signal)
      controller.signal.throwIfAborted()
      const startedAt = new Date().toISOString()
      const lock = acquireRuntimeLock(record.dataDir, {
        pid: process.pid,
        processIdentity: ownerIdentity,
        sessionId,
        controlPort: port,
        startedAt,
      })
      if (!lock.acquired) return fail('RUNTIME_BUSY')
      locked = true
      repository.updateStatus(id, 'starting')
      changed()
      phase('launch')
      if (config.proxy) {
        const password = config.proxy.credentialRef
          ? credentials.read(config.proxy.credentialRef)
          : ''
        if (password === undefined) throw new Error('CREDENTIAL_UNAVAILABLE')
        transport = await openProxyTransport(config.proxy, password)
      }
      controller.signal.throwIfAborted()
      if (config.commonConfig.language === 'auto' || config.commonConfig.timezone === 'auto') {
        phase('configure')
        if (!options.locale) throw new Error('IP_LOCALE_FAILED')
        const locale = await options.locale.detect(transport?.authentication, controller.signal)
        controller.signal.throwIfAborted()
        config.commonConfig = applyIpLocale(config.commonConfig, locale)
        phase('launch')
      }
      const plan = kernels.buildLaunchPlan(record, config, transport?.args)
      prepareBrowserProfile(record.dataDir, config.commonConfig.language, Boolean(config.proxy))
      const child = driver.launch(plan)
      child.once('error', () => {
        controller.abort()
        if (managed) managed.startFailed = true
      })
      if (!child.pid) throw new Error('SPAWN_FAILED')
      budget = createStartupBudget(controller.signal)
      managed = {
        child,
        control,
        sessionId,
        dataDir: record.dataDir,
        stopRequested: false,
        startFailed: false,
        closeProxy: transport?.close,
        releaseKernel,
      }
      const session = managed
      sessions.set(id, session)
      updateRuntimeLockOwner(record.dataDir, {
        pid: child.pid,
        sessionId,
        controlPort: port,
        startedAt,
      })
      repository.createRuntimeSession({
        sessionId,
        environmentId: id,
        pid: child.pid,
        controlPort: port,
        startedAt,
        status: 'starting',
        exitReason: null,
        revision: record.revision,
        kernelVersion: record.kernelVersion,
        executableVersion: report.executableVersion,
        phase: 'launch',
      })
      child.once('exit', (code, signal) => {
        if (starting.has(id) && !controller.signal.aborted) {
          session.startFailed = true
          controller.abort()
        }
        session.closeSettings?.()
        session.control.close()
        void session.closeProxy?.()
        if (sessions.get(id) === session) sessions.delete(id)
        const failed = session.startFailed || (code !== 0 && !session.stopRequested)
        repository.updateRuntimeSession(
          sessionId,
          failed ? 'crashed' : 'stopped',
          session.startFailed
            ? 'START_FAILED'
            : session.stopRequested
              ? (session.stopReason ?? 'USER_STOPPED')
              : signal
                ? 'PROCESS_SIGNAL'
                : code === 0
                  ? 'BROWSER_CLOSED'
                  : 'PROCESS_CRASHED',
        )
        repository.updateStatus(id, failed ? 'needs-recovery' : 'stopped')
        releaseRuntimeLock(record.dataDir, sessionId)
        session.releaseKernel()
        changed()
      })
      control.attach(child)
      const [browserVersion, processIdentity] = await Promise.all([
        driver.ready(control, budget.signal, budget.deadline),
        confirmProcessIdentity({
          pid: child.pid,
          signal: budget.signal,
          alive: () => isChildRunning(child),
          probe: driver.identity,
        }),
      ])
      budget.throwIfAborted()
      if (!isChildRunning(child) || session.stopRequested) throw new Error('START_FAILED')
      session.processIdentity = processIdentity
      if (!repository.setRuntimeProcessIdentity(sessionId, child.pid, processIdentity))
        throw new Error('START_FAILED')
      updateRuntimeLockOwner(record.dataDir, {
        pid: child.pid,
        processIdentity,
        sessionId,
        controlPort: port,
        startedAt,
      })
      if (
        record.kernelVersion !== 'local' &&
        browserVersion?.match(/\d+\.\d+\.\d+\.\d+/)?.[0] !== record.kernelVersion
      )
        throw new Error('KERNEL_VERSION_MISMATCH')
      if (browserVersion) kernels.observeCdp(record, browserVersion)
      if (browserVersion)
        repository.setRuntimeVersion(
          sessionId,
          browserVersion.match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? browserVersion,
        )
      phase('configure')
      const settingsLease = control.lease()
      const settingsConnection: { close?: () => void } = {}
      session.closeSettings = () => {
        settingsConnection.close?.()
        settingsLease.revoke()
      }
      settingsConnection.close = await driver.settings(
        settingsLease.access,
        config.commonConfig,
        () => {
          // Closing the browser normally disconnects CDP before the OS reports process exit.
          void waitForChildExit(child, 3000).then((exited) => {
            if (exited || session.stopRequested) return
            session.startFailed = true
            terminateChild(child, 'SIGTERM', session.processIdentity)
          })
        },
        transport?.authentication,
        () => {
          void stop(id, 'BROWSER_CLOSED').catch(() => {
            session.startFailed = true
            terminateChild(child, 'SIGTERM', session.processIdentity)
          })
        },
        budget.signal,
        budget.deadline,
      )
      budget.throwIfAborted()
      if (!isChildRunning(child)) throw new Error('START_FAILED')
      repository.updateRuntimeSession(sessionId, 'running')
      repository.updateStatus(id, 'running')
      changed()
      return ok(toSummary(repository.get(id)!))
    } catch (error) {
      // Freeze the startup outcome before slower child/proxy cleanup can cross its deadline.
      budget?.dispose()
      budget?.abort()
      control?.close()
      await transport?.close()
      const cancelled = controller.signal.aborted && !managed?.startFailed
      if (managed) {
        managed.startFailed = !cancelled
        managed.stopRequested = cancelled
        managed.closeSettings?.()
        terminateChild(managed.child, 'SIGTERM', managed.processIdentity)
        if (!(await waitForChildExit(managed.child))) {
          terminateChild(managed.child, 'SIGKILL', managed.processIdentity)
          await waitForChildExit(managed.child, 2000)
        }
        if (isChildRunning(managed.child)) {
          repository.updateStatus(id, 'needs-recovery')
          changed()
          return fail('STOP_TIMEOUT') // Keep the lock while the child may still own its data.
        }
      }
      if (locked) releaseRuntimeLock(record.dataDir, sessionId)
      sessions.delete(id)
      repository.updateStatus(id, cancelled ? 'stopped' : 'error')
      changed()
      const known = [
        'BROWSER_PREFERENCES_INVALID',
        'BROWSER_PREFERENCES_TOO_LARGE',
        'BROWSER_PROFILE_IO_FAILED',
        'BROWSER_PROFILE_UNSAFE',
        'IP_LOCALE_FAILED',
        'IP_LOCALE_TIMEOUT',
        'IP_LOCALE_BUSY',
        'IP_LOCALE_RATE_LIMITED',
        'IP_LOCALE_INVALID_RESPONSE',
        'CREDENTIAL_UNAVAILABLE',
        'CONTROL_TIMEOUT',
        'CONTROL_UNAVAILABLE',
        'CONTROL_PIPE_UNAVAILABLE',
        'SPAWN_FAILED',
        'PROVIDER_UNVERIFIED',
        'KERNEL_VERSION_MISMATCH',
        'OPERATION_IN_PROGRESS',
        'KERNEL_REMOVAL_PENDING',
      ]
      return fail(
        cancelled
          ? 'CANCELLED'
          : budget?.timedOut
            ? 'CONTROL_TIMEOUT'
            : error instanceof Error && known.includes(error.message)
              ? error.message
              : 'START_FAILED',
      )
    } finally {
      budget?.dispose()
      starting.delete(id)
      if (!managed || !isChildRunning(managed.child)) {
        control?.close()
        releaseKernel?.()
      }
    }
  }
  function start(id: string, phase?: (value: string) => void) {
    const task = startImpl(id, phase)
    startTasks.add(task)
    void task.then(
      () => startTasks.delete(task),
      () => startTasks.delete(task),
    )
    return task
  }
  async function stopImpl(
    id: string,
    reason: 'USER_STOPPED' | 'BROWSER_CLOSED',
  ): Promise<IpcResult<EnvironmentSummary>> {
    const record = repository.get(id)
    if (!record) return fail('NOT_FOUND')
    const session = sessions.get(id)
    if (!session) return recover(id)
    session.stopRequested = true
    session.stopReason = reason
    repository.updateStatus(id, 'stopping')
    repository.updateRuntimeSession(session.sessionId, 'stopping')
    changed()
    session.closeSettings?.()
    try {
      await driver.close?.(session.control)
    } catch {
      /* Fall back to the owned child handle. */
    }
    if (isChildRunning(session.child)) await waitForChildExit(session.child, 3000)
    terminateChild(session.child, 'SIGTERM', session.processIdentity)
    if (!(await waitForChildExit(session.child))) {
      terminateChild(session.child, 'SIGKILL', session.processIdentity)
      if (!(await waitForChildExit(session.child, 2000))) {
        repository.updateStatus(id, 'needs-recovery')
        changed()
        return fail('STOP_TIMEOUT')
      }
    }
    session.control.close()
    await session.closeProxy?.()
    sessions.delete(id)
    releaseRuntimeLock(record.dataDir, session.sessionId)
    session.releaseKernel()
    repository.updateRuntimeSession(session.sessionId, 'stopped', reason)
    repository.updateStatus(id, 'stopped')
    changed()
    return ok(toSummary(repository.get(id)!))
  }
  function stop(id: string, reason: 'USER_STOPPED' | 'BROWSER_CLOSED' = 'USER_STOPPED') {
    const pending = stopping.get(id)
    if (pending) return pending
    const operation = stopImpl(id, reason).finally(() => stopping.delete(id))
    stopping.set(id, operation)
    return operation
  }
  async function recover(id: string): Promise<IpcResult<EnvironmentSummary>> {
    const record = repository.get(id)
    if (!record) return fail('NOT_FOUND')
    if (sessions.has(id) || starting.has(id)) return fail('RUNTIME_BUSY')
    const lock = inspectRuntimeLock(record.dataDir)
    const previous = repository
      .listRuntimeSessions()
      .filter(
        (session) =>
          session.environmentId === id &&
          ['starting', 'running', 'stopping'].includes(session.status),
      )
    if (
      lock.live ||
      previous.some((session) => isRuntimeProcessAlive(session.pid, session.processIdentity))
    )
      return fail('RECOVERY_MANUAL_REQUIRED')
    if (existsSync(lock.lockPath) && !lock.owner) return fail('RECOVERY_LOCK_UNREADABLE')
    for (const session of previous)
      repository.updateRuntimeSession(session.sessionId, 'crashed', 'CLIENT_INTERRUPTED')
    releaseRuntimeLock(record.dataDir, lock.owner?.sessionId)
    repository.updateStatus(id, 'stopped')
    changed()
    return ok(toSummary(repository.get(id)!))
  }
  return {
    start,
    stop,
    recover,
    recoverOnStartup,
    cancelStarts: () => {
      for (const controller of starting.values()) controller.abort()
    },
    cancelStart: (id: string) => starting.get(id)?.abort(),
    session: (id: string) => sessions.get(id),
    leaseControl(id: string) {
      const session = sessions.get(id)
      if (!session || session.stopRequested || session.startFailed || starting.has(id))
        throw new Error('ENVIRONMENT_NOT_RUNNING')
      return session.control.lease()
    },
    async shutdown() {
      shuttingDown = true
      for (const controller of starting.values()) controller.abort()
      await Promise.allSettled([...startTasks])
      await Promise.all([...sessions.keys()].map((id) => stop(id)))
    },
  }
}
export type RuntimeSupervisor = ReturnType<typeof createRuntimeSupervisor>
