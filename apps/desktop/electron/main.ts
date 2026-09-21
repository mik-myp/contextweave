import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import log from 'electron-log/main'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  createEnvironmentInputSchema,
  environmentConfigSchema,
  saveProxyInputSchema,
  type EnvironmentConfig,
  type EnvironmentSummary,
  type IpcResult,
  type KernelManifest,
  type TargetArchitecture,
  type TargetPlatform,
  defaultThemeConfig,
  themeConfigSchema,
  type ThemeConfig,
} from '@contextweave/contracts'
import {
  installKernelPackage,
  KernelRegistry,
  type BrowserKernelAdapter,
  type LaunchPlan,
} from '@contextweave/kernel-core'
import {
  createFingerprintChromiumManifest,
  FingerprintChromiumAdapter,
} from '@contextweave/kernel-fingerprint-chromium'
import {
  createStandardChromiumManifest,
  discoverStandardChromiumExecutable,
  StandardChromiumAdapter,
} from '@contextweave/kernel-standard-chromium'
import {
  acquireRuntimeLock,
  EnvironmentRepository,
  inspectRuntimeLock,
  isProcessAlive,
  openLocalDatabase,
  releaseRuntimeLock,
  type EnvironmentRecord,
  type KernelInstallationRecord,
  type ProxyRecord,
  updateRuntimeLockOwner,
} from '@contextweave/storage'
import { workerTaskSchema, type WorkerResult } from '@contextweave/worker-protocol'

log.initialize()

const APP_ROOT = resolve(__dirname, '..')
const RENDERER_DIST = join(APP_ROOT, 'dist')
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL
const targetPlatform = process.platform as TargetPlatform
const targetArch = (process.arch === 'arm64' ? 'arm64' : 'x64') as TargetArchitecture

const registry = new KernelRegistry()
registry.register(
  new FingerprintChromiumAdapter(createFingerprintChromiumManifest(targetPlatform, targetArch)),
)
registry.register(
  new StandardChromiumAdapter(createStandardChromiumManifest(targetPlatform, targetArch)),
)

type ManagedSession = {
  child: ChildProcess
  port: number
  sessionId: string
  dataDir: string
  stopRequested: boolean
  startFailed: boolean
}

type CredentialFile = Record<string, string>
type WorkerProxyCredentials = { username: string; password: string }
type ManagedWorker = { child: ChildProcess; cancelRequested: boolean }

const sessions = new Map<string, ManagedSession>()
const workerProcesses = new Map<string, ManagedWorker>()
let database: ReturnType<typeof openLocalDatabase> | undefined
let environments: EnvironmentRepository | undefined
let mainWindow: BrowserWindow | null = null
let isQuitting = false

function databaseOrThrow(): EnvironmentRepository {
  if (!environments) throw new Error('Local database is not ready')
  return environments
}

function dataRoot(): string {
  return join(app.getPath('userData'), 'contextweave')
}

function environmentRoot(): string {
  return join(dataRoot(), 'environments')
}

function credentialFilePath(): string {
  return join(dataRoot(), 'credentials.json')
}

function readCredentialFile(): CredentialFile {
  try {
    const parsed = JSON.parse(readFileSync(credentialFilePath(), { encoding: 'utf8' })) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

function writeCredentialFile(credentials: CredentialFile): void {
  const temporaryPath = `${credentialFilePath()}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(temporaryPath, credentialFilePath())
}

function saveCredential(reference: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System secure storage is unavailable')
  }
  const credentials = readCredentialFile()
  credentials[reference] = safeStorage.encryptString(value).toString('base64')
  writeCredentialFile(credentials)
}

function readCredential(reference: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  const encoded = readCredentialFile()[reference]
  if (!encoded) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return undefined
  }
}

function deleteCredential(reference?: string): void {
  if (!reference) return
  const credentials = readCredentialFile()
  if (!(reference in credentials)) return
  delete credentials[reference]
  writeCredentialFile(credentials)
}

function toSummary(record: EnvironmentRecord): EnvironmentSummary {
  return {
    id: record.environmentId,
    name: record.name,
    status: record.status,
    kernelId: record.kernelId,
    kernelVersion: record.kernelVersion,
    platform: record.platform,
    arch: record.arch,
    updatedAt: record.updatedAt,
  }
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail<T = never>(code: string, message: string): IpcResult<T> {
  return { ok: false, code, message }
}

function manifestToKernelSummary(
  manifest: KernelManifest,
  executablePath?: string,
  installation?: KernelInstallationRecord,
) {
  return {
    id: manifest.id,
    label: manifest.id === 'fingerprint-chromium' ? 'Fingerprint Chromium' : 'Standard Chromium',
    family: manifest.family,
    platform: manifest.platform,
    arch: manifest.arch,
    version: manifest.version,
    status: executablePath
      ? 'available'
      : installation?.state === 'installed'
        ? 'not-installed'
        : 'not-configured',
    executablePath,
    installationPath: installation?.installPath,
    packageAvailable: Boolean(manifest.package?.url && manifest.package.sha256),
    capabilities: manifest.capabilities,
  } as const
}

function isActiveSessionStatus(status: string): boolean {
  return status === 'starting' || status === 'running' || status === 'stopping'
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!isChildRunning(child)) return
  try {
    child.kill(signal)
  } catch (error) {
    log.warn('Failed to terminate browser process', error)
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 3000): Promise<boolean> {
  if (!isChildRunning(child)) return true
  return new Promise((resolveExit) => {
    let settled = false
    const settle = (exited: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveExit(exited)
    }
    const timer = setTimeout(() => settle(!isChildRunning(child)), timeoutMs)
    child.once('exit', () => settle(true))
  })
}

function recoverRuntimeSessions(): void {
  const repository = databaseOrThrow()
  for (const persisted of repository.listRuntimeSessions()) {
    if (!isActiveSessionStatus(persisted.status)) continue
    const record = repository.get(persisted.environmentId)
    if (!record) {
      repository.updateRuntimeSession(
        persisted.sessionId,
        'crashed',
        'Environment record no longer exists',
      )
      continue
    }

    if (isProcessAlive(persisted.pid)) {
      const lock = inspectRuntimeLock(record.dataDir)
      if (!lock.live) {
        try {
          acquireRuntimeLock(record.dataDir, {
            pid: persisted.pid,
            sessionId: persisted.sessionId,
            controlPort: persisted.controlPort,
            startedAt: persisted.startedAt,
          })
          updateRuntimeLockOwner(record.dataDir, {
            pid: persisted.pid,
            sessionId: persisted.sessionId,
            controlPort: persisted.controlPort,
            startedAt: persisted.startedAt,
          })
        } catch (error) {
          log.warn('Unable to preserve an orphan browser lock', error)
        }
      }
      repository.updateRuntimeSession(
        persisted.sessionId,
        'stopping',
        'Browser process survived the previous client session',
      )
      repository.updateStatus(record.environmentId, 'needs-recovery')
      continue
    }

    releaseRuntimeLock(record.dataDir, persisted.sessionId)
    repository.updateRuntimeSession(
      persisted.sessionId,
      'crashed',
      'Browser process was not running during recovery',
    )
    repository.updateStatus(record.environmentId, 'needs-recovery')
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a local control port'))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

async function waitForCdp(port: number, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // The browser may need several attempts before its control endpoint is ready.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`Browser control endpoint did not become ready on port ${port}`)
}

function proxyArgs(config: EnvironmentConfig): string[] {
  if (!config.proxy) return []
  const { type, host, port } = config.proxy
  return [`--proxy-server=${type}://${host}:${port}`]
}

function commonChromiumArgs(config: EnvironmentConfig): string[] {
  const args = [
    `--lang=${config.commonConfig.language}`,
    `--window-size=${config.commonConfig.window.width},${config.commonConfig.window.height}`,
  ]
  if (config.commonConfig.userAgent) args.push(`--user-agent=${config.commonConfig.userAgent}`)
  if (config.commonConfig.webRtcPolicy === 'proxy') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')
  }
  return args
}

function executableFor(record: EnvironmentRecord, config: EnvironmentConfig): string | undefined {
  const configured = config.kernelConfig.executablePath
  if (typeof configured === 'string' && existsSync(configured)) return configured
  const manifest = registry.get(record.kernelId).getManifest()
  const installation = databaseOrThrow().getKernelInstallation(
    manifest.id,
    manifest.version,
    manifest.platform,
    manifest.arch,
  )
  if (installation?.state === 'installed') {
    const installedExecutable = join(installation.installPath, manifest.executable)
    if (existsSync(installedExecutable)) return installedExecutable
  }
  if (record.kernelId === 'standard-chromium') {
    return discoverStandardChromiumExecutable(process.platform)[0]
  }
  return undefined
}

async function installKernel(
  kernelId: string,
): Promise<IpcResult<ReturnType<typeof manifestToKernelSummary>>> {
  let adapter: BrowserKernelAdapter
  try {
    adapter = registry.get(kernelId)
  } catch (error) {
    return fail('KERNEL_NOT_FOUND', error instanceof Error ? error.message : 'Kernel was not found')
  }
  const manifest = adapter.getManifest()
  try {
    const result = await installKernelPackage(manifest, join(dataRoot(), 'kernels'))
    const installation = databaseOrThrow().recordKernelInstallation({
      kernelId: manifest.id,
      version: manifest.version,
      platform: manifest.platform,
      arch: manifest.arch,
      sourceUrl: manifest.package?.url ?? null,
      sha256: result.sha256,
      installPath: result.installPath,
      state: 'installed',
    })
    return ok(manifestToKernelSummary(manifest, result.executablePath, installation))
  } catch (error) {
    return fail(
      'KERNEL_INSTALL_FAILED',
      error instanceof Error ? error.message : 'Kernel installation failed',
    )
  }
}

function buildLaunchPlan(
  record: EnvironmentRecord,
  config: EnvironmentConfig,
  port: number,
): LaunchPlan {
  const adapter = registry.get(record.kernelId) as BrowserKernelAdapter
  const executablePath = executableFor(record, config)
  if (!executablePath) {
    throw new Error(`No executable is configured for ${record.kernelId}`)
  }
  const validation = adapter.validateConfig(config.kernelConfig)
  if (!validation.ok) throw new Error(validation.issues.join('; '))
  return adapter.buildLaunchPlan(
    {
      environmentId: record.environmentId,
      userDataDir: record.dataDir,
      controlPort: port,
      executablePath,
      proxyArgs: proxyArgs(config),
      commonArgs: commonChromiumArgs(config),
      kernelArgs: [],
    },
    config.kernelConfig,
  )
}

function workerPath(): string {
  return join(__dirname, 'worker.js')
}

function workerProxyCredentials(environmentId: string): WorkerProxyCredentials | undefined {
  const record = databaseOrThrow().get(environmentId)
  if (!record) return undefined
  const config = environmentConfigSchema.parse(JSON.parse(record.configJson))
  const proxy = config.proxy
  if (!proxy?.username || !proxy.credentialRef) return undefined
  const password = readCredential(proxy.credentialRef)
  if (password === undefined)
    throw new Error('Proxy credential is unavailable in system secure storage')
  return { username: proxy.username, password }
}

function runWorker(taskInput: unknown, controlPort: number): Promise<WorkerResult> {
  const task = workerTaskSchema.parse(taskInput)
  const payload = JSON.stringify({
    task,
    controlPort,
    proxyCredentials: workerProxyCredentials(task.environmentId),
  })
  const child = spawn(process.execPath, [workerPath()], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const managedWorker: ManagedWorker = { child, cancelRequested: false }
  workerProcesses.set(task.taskId, managedWorker)
  return new Promise((resolveWorker, rejectWorker) => {
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', (error) => {
      workerProcesses.delete(task.taskId)
      if (managedWorker.cancelRequested) {
        resolveWorker({
          protocolVersion: task.protocolVersion,
          taskId: task.taskId,
          environmentId: task.environmentId,
          ok: false,
          errorCode: 'CANCELLED',
          errorMessage: 'Worker task was cancelled',
        })
      } else {
        rejectWorker(error)
      }
    })
    child.once('exit', (code) => {
      workerProcesses.delete(task.taskId)
      if (managedWorker.cancelRequested) {
        resolveWorker({
          protocolVersion: task.protocolVersion,
          taskId: task.taskId,
          environmentId: task.environmentId,
          ok: false,
          errorCode: 'CANCELLED',
          errorMessage: 'Worker task was cancelled',
        })
        return
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
      if (line) {
        try {
          resolveWorker(JSON.parse(line) as WorkerResult)
          return
        } catch {
          // Fall through to a structured process error below.
        }
      }
      rejectWorker(new Error(stderr.trim() || `Worker exited with code ${code ?? 'unknown'}`))
    })
    child.stdin?.end(payload)
  })
}

function cancelWorker(taskId: string): IpcResult<boolean> {
  const managedWorker = workerProcesses.get(taskId)
  if (!managedWorker) return ok(false)
  managedWorker.cancelRequested = true
  terminateChild(managedWorker.child)
  return ok(true)
}

async function createEnvironment(input: unknown): Promise<IpcResult<EnvironmentSummary>> {
  const parsed = createEnvironmentInputSchema.safeParse(input)
  if (!parsed.success)
    return fail('INVALID_INPUT', parsed.error.issues.map((issue) => issue.message).join('; '))
  let kernel: BrowserKernelAdapter
  try {
    kernel = registry.get(parsed.data.kernelId)
  } catch (error) {
    return fail('KERNEL_NOT_FOUND', error instanceof Error ? error.message : 'Kernel was not found')
  }
  const manifest = kernel.getManifest()
  const repository = databaseOrThrow()
  const proxyRecord = parsed.data.proxyId ? repository.getProxy(parsed.data.proxyId) : undefined
  if (parsed.data.proxyId && !proxyRecord)
    return fail('PROXY_NOT_FOUND', 'The selected proxy was not found')
  const proxy = proxyRecord
    ? {
        type: proxyRecord.type,
        host: proxyRecord.host,
        port: proxyRecord.port,
        username: proxyRecord.username,
        credentialRef: proxyRecord.credentialRef,
      }
    : parsed.data.proxy
  const environmentId = `env-${randomUUID()}`
  const config: EnvironmentConfig = environmentConfigSchema.parse({
    environmentId,
    name: parsed.data.name,
    kernelId: manifest.id,
    kernelVersion: manifest.version,
    proxyId: proxyRecord?.proxyId ?? (proxy ? `proxy-${randomUUID()}` : undefined),
    proxy,
    commonConfig: parsed.data.commonConfig,
    kernelConfig: parsed.data.kernelConfig,
  })
  const dataDir = join(environmentRoot(), environmentId)
  mkdirSync(dataDir, { recursive: true })
  const record = repository.create({ config, dataDir, platform: targetPlatform, arch: targetArch })
  return ok(toSummary(record))
}

function proxySummary(record: ProxyRecord): ProxyRecord {
  return record
}

function getThemeSettings(): ThemeConfig {
  const stored = databaseOrThrow().getSetting<unknown>('theme')
  const parsed = themeConfigSchema.safeParse(stored)
  return parsed.success ? parsed.data : defaultThemeConfig
}

function setThemeSettings(input: unknown): IpcResult<ThemeConfig> {
  const parsed = themeConfigSchema.safeParse(input)
  if (!parsed.success)
    return fail('INVALID_THEME', parsed.error.issues.map((issue) => issue.message).join('; '))
  databaseOrThrow().setSetting('theme', parsed.data)
  return ok(parsed.data)
}

async function saveProxy(input: unknown): Promise<IpcResult<ProxyRecord>> {
  const parsed = saveProxyInputSchema.safeParse(input)
  if (!parsed.success)
    return fail('INVALID_INPUT', parsed.error.issues.map((issue) => issue.message).join('; '))
  const repository = databaseOrThrow()
  const proxyId = parsed.data.proxyId ?? `proxy-${randomUUID()}`
  const previous = parsed.data.proxyId ? repository.getProxy(proxyId) : undefined
  let credentialRef = previous?.credentialRef
  try {
    if (parsed.data.password) {
      credentialRef = `proxy:${proxyId}:password`
      saveCredential(credentialRef, parsed.data.password)
    }
    const record = repository.saveProxy(proxyId, {
      ...parsed.data.config,
      credentialRef,
    })
    return ok(proxySummary(record))
  } catch (error) {
    return fail(
      'PROXY_SAVE_FAILED',
      error instanceof Error ? error.message : 'Unable to save proxy',
    )
  }
}

function deleteProxy(proxyId: string): IpcResult<boolean> {
  const repository = databaseOrThrow()
  const record = repository.getProxy(proxyId)
  if (!record) return fail('NOT_FOUND', 'Proxy was not found')
  repository.deleteProxy(proxyId)
  deleteCredential(record.credentialRef)
  return ok(true)
}

async function startEnvironment(environmentId: string): Promise<IpcResult<EnvironmentSummary>> {
  const repository = databaseOrThrow()
  const record = repository.get(environmentId)
  if (!record) return fail('NOT_FOUND', 'Browser environment was not found')
  if (sessions.has(environmentId))
    return fail('ALREADY_RUNNING', 'This environment is already running')
  let config: EnvironmentConfig
  try {
    config = environmentConfigSchema.parse(JSON.parse(record.configJson))
  } catch (error) {
    return fail(
      'INVALID_CONFIG',
      error instanceof Error ? error.message : 'Environment configuration is invalid',
    )
  }
  let port: number
  try {
    port = await findFreePort()
  } catch (error) {
    return fail(
      'PORT_ALLOCATION_FAILED',
      error instanceof Error ? error.message : 'Unable to allocate a control port',
    )
  }
  const sessionId = `session-${randomUUID()}`
  const lockResult = acquireRuntimeLock(record.dataDir, {
    pid: process.pid,
    sessionId,
    controlPort: port,
    startedAt: new Date().toISOString(),
  })
  if (!lockResult.acquired) {
    const ownerMessage = lockResult.owner
      ? `PID ${lockResult.owner.pid} is still using this environment`
      : 'An incomplete runtime lock is still present'
    return fail('RUNTIME_IN_USE', ownerMessage)
  }

  let managedSession: ManagedSession | undefined
  let persistedSession = false
  try {
    const plan = buildLaunchPlan(record, config, port)
    repository.updateStatus(environmentId, 'starting')
    const child = spawn(plan.executablePath, plan.args, { stdio: 'ignore', windowsHide: true })
    if (!child.pid) throw new Error('Browser process did not provide a PID')
    managedSession = {
      child,
      port,
      sessionId,
      dataDir: record.dataDir,
      stopRequested: false,
      startFailed: false,
    }
    sessions.set(environmentId, managedSession)
    updateRuntimeLockOwner(record.dataDir, {
      pid: child.pid,
      sessionId,
      controlPort: port,
      startedAt: new Date().toISOString(),
    })
    repository.createRuntimeSession({
      sessionId,
      environmentId,
      pid: child.pid,
      controlPort: port,
      startedAt: new Date().toISOString(),
      status: 'starting',
      exitReason: null,
    })
    persistedSession = true
    child.once('exit', (code, signal) => {
      sessions.delete(environmentId)
      const expectedStop = managedSession?.stopRequested === true
      const startFailed = managedSession?.startFailed === true
      const runtimeStatus = code === 0 || expectedStop ? 'stopped' : 'crashed'
      const environmentStatus = startFailed
        ? 'error'
        : runtimeStatus === 'stopped'
          ? 'stopped'
          : 'needs-recovery'
      repository.updateRuntimeSession(
        sessionId,
        runtimeStatus,
        signal ? `signal:${signal}` : code === null ? 'unknown-exit' : `exit:${code}`,
      )
      repository.updateStatus(environmentId, environmentStatus)
      releaseRuntimeLock(record.dataDir, sessionId)
      log.info('Browser process exited', { environmentId, code, signal })
    })
    await waitForCdp(port)
    repository.updateRuntimeSession(sessionId, 'running')
    repository.updateStatus(environmentId, 'running')
    return ok(toSummary(repository.get(environmentId)!))
  } catch (error) {
    if (managedSession) {
      managedSession.startFailed = true
      terminateChild(managedSession.child)
    }
    if (persistedSession) {
      repository.updateRuntimeSession(
        sessionId,
        'crashed',
        error instanceof Error ? error.message : 'Browser failed to start',
      )
    }
    sessions.delete(environmentId)
    releaseRuntimeLock(record.dataDir, sessionId)
    repository.updateStatus(environmentId, 'error')
    return fail('START_FAILED', error instanceof Error ? error.message : 'Browser failed to start')
  }
}

async function stopEnvironment(environmentId: string): Promise<IpcResult<EnvironmentSummary>> {
  const repository = databaseOrThrow()
  const record = repository.get(environmentId)
  if (!record) return fail('NOT_FOUND', 'Browser environment was not found')
  const session = sessions.get(environmentId)
  if (!session) {
    const persisted = repository
      .listRuntimeSessions()
      .find((item) => item.environmentId === environmentId && isActiveSessionStatus(item.status))
    if (persisted && isProcessAlive(persisted.pid)) {
      return fail(
        'RUNTIME_ORPHANED',
        'The browser process is still running from a previous client session; recover it before starting again',
      )
    }
    if (persisted)
      repository.updateRuntimeSession(
        persisted.sessionId,
        'crashed',
        'Browser process was not running when stop was requested',
      )
    releaseRuntimeLock(record.dataDir, persisted?.sessionId)
    repository.updateStatus(environmentId, 'stopped')
    return ok(toSummary(repository.get(environmentId)!))
  }
  session.stopRequested = true
  repository.updateStatus(environmentId, 'stopping')
  repository.updateRuntimeSession(session.sessionId, 'stopping')
  terminateChild(session.child)
  const exited = await waitForChildExit(session.child)
  if (!exited && isChildRunning(session.child)) {
    terminateChild(session.child, 'SIGKILL')
    if (!(await waitForChildExit(session.child, 2000))) {
      session.stopRequested = false
      repository.updateStatus(environmentId, 'needs-recovery')
      return fail('STOP_TIMEOUT', 'The browser process did not stop; manual recovery is required')
    }
  }
  sessions.delete(environmentId)
  repository.updateRuntimeSession(session.sessionId, 'stopped', 'Stopped by user')
  releaseRuntimeLock(record.dataDir, session.sessionId)
  repository.updateStatus(environmentId, 'stopped')
  return ok(toSummary(repository.get(environmentId)!))
}

async function recoverEnvironment(environmentId: string): Promise<IpcResult<EnvironmentSummary>> {
  const repository = databaseOrThrow()
  const record = repository.get(environmentId)
  if (!record) return fail('NOT_FOUND', 'Browser environment was not found')
  const persisted = repository
    .listRuntimeSessions()
    .find((item) => item.environmentId === environmentId && isActiveSessionStatus(item.status))
  if (persisted && isProcessAlive(persisted.pid)) {
    const lock = inspectRuntimeLock(record.dataDir)
    if (lock.owner?.pid !== persisted.pid) {
      return fail(
        'RECOVERY_UNSAFE',
        'The runtime owner could not be verified; stop the browser manually before recovery',
      )
    }
    try {
      process.kill(persisted.pid)
    } catch (error) {
      return fail(
        'RECOVERY_FAILED',
        error instanceof Error ? error.message : 'Unable to stop the orphan browser',
      )
    }
    const startedAt = Date.now()
    while (Date.now() - startedAt < 3000 && isProcessAlive(persisted.pid)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    if (isProcessAlive(persisted.pid))
      return fail('RECOVERY_TIMEOUT', 'The orphan browser did not stop')
  }
  if (persisted)
    repository.updateRuntimeSession(
      persisted.sessionId,
      'stopped',
      'Recovered after client restart',
    )
  releaseRuntimeLock(record.dataDir, persisted?.sessionId)
  repository.updateStatus(environmentId, 'stopped')
  return ok(toSummary(repository.get(environmentId)!))
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-info', () =>
    ok({
      name: 'ContextWeave',
      version: app.getVersion(),
      platform: targetPlatform,
      arch: targetArch,
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    }),
  )
  ipcMain.handle('app:get-paths', () =>
    ok({
      userData: app.getPath('userData'),
      dataRoot: dataRoot(),
      environmentRoot: environmentRoot(),
      kernelRoot: join(dataRoot(), 'kernels'),
      logRoot: join(dataRoot(), 'logs'),
    }),
  )
  ipcMain.handle('kernel:list', () => {
    const standardPath = discoverStandardChromiumExecutable(process.platform)[0]
    const repository = databaseOrThrow()
    return ok(
      registry.list().map((adapter) => {
        const manifest = adapter.getManifest()
        const installation = repository.getKernelInstallation(
          manifest.id,
          manifest.version,
          manifest.platform,
          manifest.arch,
        )
        const installedPath =
          installation?.state === 'installed'
            ? join(installation.installPath, manifest.executable)
            : undefined
        return manifestToKernelSummary(
          manifest,
          manifest.id === 'standard-chromium'
            ? standardPath
            : existsSync(installedPath ?? '')
              ? installedPath
              : undefined,
          installation,
        )
      }),
    )
  })
  ipcMain.handle('kernel:install', (_event, kernelId: string) => installKernel(kernelId))
  ipcMain.handle('proxy:list', () => ok(databaseOrThrow().listProxies().map(proxySummary)))
  ipcMain.handle('proxy:save', (_event, input: unknown) => saveProxy(input))
  ipcMain.handle('proxy:delete', (_event, proxyId: string) => deleteProxy(proxyId))
  ipcMain.handle('environment:list', () => ok(databaseOrThrow().list().map(toSummary)))
  ipcMain.handle('environment:create', (_event, input: unknown) => createEnvironment(input))
  ipcMain.handle('environment:start', (_event, environmentId: string) =>
    startEnvironment(environmentId),
  )
  ipcMain.handle('environment:stop', (_event, environmentId: string) =>
    stopEnvironment(environmentId),
  )
  ipcMain.handle('environment:recover', (_event, environmentId: string) =>
    recoverEnvironment(environmentId),
  )
  ipcMain.handle('worker:run-smoke', async (_event, input: unknown) => {
    const task = workerTaskSchema.safeParse(input)
    if (!task.success)
      return fail('INVALID_TASK', task.error.issues.map((issue) => issue.message).join('; '))
    const session = sessions.get(task.data.environmentId)
    if (!session)
      return fail('ENVIRONMENT_NOT_RUNNING', 'Start the environment before running a Worker task')
    try {
      return ok(await runWorker(task.data, session.port))
    } catch (error) {
      return fail('WORKER_FAILED', error instanceof Error ? error.message : 'Worker failed')
    }
  })
  ipcMain.handle('worker:cancel', (_event, taskId: string) => cancelWorker(taskId))
  ipcMain.handle('app:open-external', (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return fail('INVALID_URL', 'Only HTTP(S) URLs can be opened')
    void shell.openExternal(url)
    return ok(true)
  })
  ipcMain.handle('settings:get-theme', () => ok(getThemeSettings()))
  ipcMain.handle('settings:set-theme', (_event, input: unknown) => setThemeSettings(input))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(join(RENDERER_DIST, 'index.html'))
  }
}

app
  .whenReady()
  .then(() => {
    mkdirSync(dataRoot(), { recursive: true })
    mkdirSync(environmentRoot(), { recursive: true })
    database = openLocalDatabase(join(dataRoot(), 'contextweave.sqlite'))
    environments = new EnvironmentRepository(database.sqlite)
    recoverRuntimeSessions()
    registerIpcHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    log.error('Failed to initialize ContextWeave', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()
  for (const [environmentId, session] of sessions) {
    session.stopRequested = true
    environments?.updateRuntimeSession(session.sessionId, 'stopping', 'Client is closing')
    environments?.updateStatus(environmentId, 'stopping')
    terminateChild(session.child)
  }
  void Promise.all(
    [...sessions.values()].map((session) => waitForChildExit(session.child, 3000)),
  ).then(() => app.quit())
})

app.on('will-quit', () => {
  database?.close()
})
