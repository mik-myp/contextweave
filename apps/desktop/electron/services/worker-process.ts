import { EventEmitter } from 'node:events'
import type { ForkOptions } from 'electron'

interface UtilityWorkerSource {
  readonly pid: number | undefined
  once(event: 'spawn', listener: () => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
  once(event: 'error', listener: () => void): unknown
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
}
/** Utility exit notification can precede OS termination; both are required. */
export interface WorkerProcess extends UtilityWorkerSource {
  hasExited(): boolean
}
export type ForkWorker = (modulePath: string) => WorkerProcess

const allowedEnvironment = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'HOME',
  'USER',
  'LOGNAME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
])
export function workerForkOptions(
  environment: Record<string, string | undefined>,
): ForkOptions & { env: Record<string, string> } {
  // Electron treats an empty map as 'inherit everything'. Keep it non-empty even
  // when the host supplied no allowlisted variables; this is not an auth bypass.
  const env: Record<string, string> = { CONTEXTWEAVE_WORKER: '1' }
  for (const [key, value] of Object.entries(environment))
    if (allowedEnvironment.has(key.toUpperCase()) && value !== undefined) env[key] = value
  return {
    env,
    execArgv: [],
    stdio: 'ignore',
    serviceName: 'ContextWeave Worker',
    allowLoadingUnsignedLibraries: false,
  }
}

function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0) // Read-only existence check, NEVER a termination signal.
    return false
  } catch (error) {
    // Permission denial or other ambiguity must not release ownership. PID reuse
    // can conservatively retain a slot; we never kill a PID through this check.
    return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'
  }
}

class OwnedUtilityWorker extends EventEmitter implements WorkerProcess {
  private ownedPid: number | undefined
  private exitNotified = false
  private spawned = false
  constructor(
    private readonly child: UtilityWorkerSource,
    private readonly isGone: (pid: number) => boolean,
  ) {
    super()
    child.once('spawn', () => {
      this.spawned = true
      this.ownedPid = child.pid
      this.emit('spawn')
    })
    child.on('message', (message) => this.emit('message', message))
    // Discard diagnostic report/location before they can cross the domain boundary.
    child.once('error', () => this.emit('error'))
    child.once('exit', (code) => {
      this.exitNotified = true
      this.emit('exit', code)
    })
  }
  get pid() {
    return this.exitNotified ? undefined : this.ownedPid
  }
  postMessage(message: unknown) {
    this.child.postMessage(message)
  }
  kill() {
    return !this.exitNotified && this.child.kill()
  }
  hasExited() {
    if (!this.exitNotified) return false
    if (this.ownedPid === undefined) return !this.spawned
    try {
      return this.isGone(this.ownedPid)
    } catch {
      return false
    }
  }
}

export function createUtilityWorkerLauncher(
  utility: { fork(path: string, args: string[], options: ForkOptions): UtilityWorkerSource },
  environment: Record<string, string | undefined> = process.env,
  isGone: (pid: number) => boolean = isProcessGone,
): ForkWorker {
  return (modulePath) =>
    new OwnedUtilityWorker(utility.fork(modulePath, [], workerForkOptions(environment)), isGone)
}
