import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, rename, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appUpdateStateSchema,
  type AppUpdateState,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'
import { fetchAppRelease, selectAppUpdate } from './app-update-release'
import { downloadVerifiedFile } from './verified-download'

export function createAppUpdateService(options: {
  currentVersion: string
  platform: TargetPlatform
  arch: TargetArchitecture
  root: string
  openPath: (path: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  hasActiveEnvironments: () => boolean
  fetchRelease?: typeof fetchAppRelease
  download?: typeof downloadVerifiedFile
}) {
  let state: AppUpdateState = {
    phase: 'idle',
    currentVersion: options.currentVersion,
    receivedBytes: 0,
    totalBytes: 0,
  }
  let job: Promise<AppUpdateState> | undefined
  let controller: AbortController | undefined
  let readyPath: string | undefined
  let closing = false
  const snapshot = () => appUpdateStateSchema.parse(state)
  function run(
    phase: AppUpdateState['phase'],
    action: (signal: AbortSignal) => Promise<void>,
    failurePhase: 'error' | 'ready' = 'error',
  ) {
    if (closing) return Promise.reject(new Error('APP_CLOSING'))
    if (job) return job
    controller = new AbortController()
    const activeController = controller
    state = { ...state, phase, errorCode: undefined }
    job = Promise.resolve()
      .then(() => action(activeController.signal))
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error('UPDATE_FAILED')
        const code = 'code' in error ? error.code : undefined
        state = {
          ...state,
          phase: activeController.signal.aborted ? 'cancelled' : failurePhase,
          errorCode: activeController.signal.aborted
            ? undefined
            : code === 'ENOSPC'
              ? 'LOW_DISK'
              : ['TimeoutError', 'AbortError'].includes(error.name)
                ? 'UPDATE_TIMEOUT'
                : /^[A-Z][A-Z_]+$/.test(error.message)
                  ? error.message
                  : 'UPDATE_FAILED',
        }
      })
      .then(snapshot)
      .finally(() => {
        job = undefined
        controller = undefined
      })
    return job
  }
  return {
    getState: snapshot,
    check() {
      if (job) return job
      readyPath = undefined
      state = { ...state, release: undefined, receivedBytes: 0, totalBytes: 0 }
      return run('checking', async (signal) => {
        const input = await (options.fetchRelease ?? fetchAppRelease)(
          AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        )
        signal.throwIfAborted()
        const release = selectAppUpdate(
          input,
          options.currentVersion,
          options.platform,
          options.arch,
        )
        state = {
          ...state,
          checkedAt: new Date().toISOString(),
          release,
          phase: !release ? 'current' : release.asset ? 'available' : 'unsupported',
        }
      })
    },
    download() {
      if (job) return job
      const asset = state.release?.asset
      if (!asset) return Promise.reject(new Error('UPDATE_NOT_AVAILABLE'))
      if (state.phase === 'ready' && readyPath) return Promise.resolve(snapshot())
      state = { ...state, receivedBytes: 0, totalBytes: asset.sizeBytes }
      readyPath = undefined
      return run('downloading', async (abort) => {
        const signal = AbortSignal.any([abort, AbortSignal.timeout(30 * 60_000)])
        await mkdir(options.root, { recursive: true })
        const space = await statfs(options.root)
        if (space.bavail * space.bsize < asset.sizeBytes + 100_000_000) throw new Error('LOW_DISK')
        const stage = await mkdtemp(join(options.root, '.download-'))
        try {
          const temporary = join(stage, asset.fileName)
          await (options.download ?? downloadVerifiedFile)(
            asset,
            temporary,
            signal,
            (received, total) => {
              state = { ...state, receivedBytes: received, totalBytes: total ?? asset.sizeBytes }
            },
          )
          signal.throwIfAborted()
          const target = join(options.root, asset.fileName)
          await rm(target, { force: true })
          await rename(temporary, target)
          readyPath = target
          state = {
            ...state,
            phase: 'ready',
            receivedBytes: asset.sizeBytes,
            totalBytes: asset.sizeBytes,
          }
        } finally {
          await rm(stage, { force: true, recursive: true })
        }
      })
    },
    async cancel() {
      if (state.phase === 'downloading' || state.phase === 'checking') controller?.abort()
      return (await job) ?? snapshot()
    },
    openInstaller() {
      if (job) return job
      const path = readyPath
      const asset = state.release?.asset
      if (!path || !asset || state.phase !== 'ready')
        return Promise.reject(new Error('UPDATE_NOT_READY'))
      return run(
        'ready',
        async (signal) => {
          if (options.hasActiveEnvironments()) throw new Error('UPDATE_ENVIRONMENTS_ACTIVE')
          const file = await lstat(path).catch(() => undefined)
          if (!file?.isFile() || file.isSymbolicLink() || file.size !== asset.sizeBytes) {
            readyPath = undefined
            state = { ...state, phase: 'error' }
            throw new Error('UPDATE_FILE_INVALID')
          }
          const hash = createHash('sha256')
          for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
          if (hash.digest('hex') !== asset.sha256) {
            readyPath = undefined
            state = { ...state, phase: 'error' }
            throw new Error('PACKAGE_HASH_MISMATCH')
          }
          signal.throwIfAborted()
          if (options.hasActiveEnvironments()) throw new Error('UPDATE_ENVIRONMENTS_ACTIVE')
          if (await options.openPath(path)) throw new Error('UPDATE_OPEN_FAILED')
        },
        'ready',
      ).then((result) => {
        // Invalid cached files require a fresh verified download, not another open attempt.
        if (!readyPath) {
          state = { ...state, phase: 'error' }
          return snapshot()
        }
        return result
      })
    },
    async openRelease() {
      if (!state.release) throw new Error('UPDATE_NOT_AVAILABLE')
      try {
        await options.openExternal(state.release.url)
      } catch {
        throw new Error('UPDATE_OPEN_FAILED')
      }
      return true
    },
    async shutdown() {
      closing = true
      controller?.abort()
      await job
    },
  }
}
