// Test-host-only failure evidence. Never shipped in the Electron bundle, and never
// records source URLs, redirect locations, paths, arguments, bodies or raw errors.
export async function installKernelDiagnostics(desktop) {
  await desktop.evaluate(() => {
    if (globalThis.__cwKernelDiagnostics) throw new Error('Kernel diagnostics already installed')
    const modules = process.getBuiltinModule('node:module')
    const files = process.getBuiltinModule('node:fs')
    const promises = process.getBuiltinModule('node:fs/promises')
    const { ChildProcess } = process.getBuiltinModule('node:child_process')
    const { ReadableStreamDefaultReader } = process.getBuiltinModule('node:stream/web')
    const records = []
    const started = performance.now()
    const record = (value) => {
      if (records.length < 64)
        records.push({ atMs: Math.round(performance.now() - started), ...value })
    }
    const codes = new Set([
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'EPIPE',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_SOCKET',
      'ABORT_ERR',
      'ENOSPC',
      'EPERM',
      'EACCES',
      'EIO',
      'ENOENT',
      'EEXIST',
      'EBUSY',
      'ENOTEMPTY',
      'EMFILE',
      'ENFILE',
    ])
    const errorCode = (error) => {
      const value = error?.cause?.code ?? error?.code
      return codes.has(value) ? value : 'UNCLASSIFIED'
    }
    const failed = (operation, error) => record({ operation, code: errorCode(error) })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async function (input) {
      let source = 'other'
      try {
        const host = new URL(typeof input === 'string' ? input : input.url).hostname
        if (host === 'github.com') source = 'github'
        else if (host === 'release-assets.githubusercontent.com') source = 'release-assets'
        else if (host === 'objects.githubusercontent.com') source = 'objects'
      } catch {
        /* Do not log or change how the real fetch validates its input. */
      }
      try {
        const response = await Reflect.apply(originalFetch, this, arguments)
        record({ operation: 'fetch', source, status: response.status })
        return response
      } catch (error) {
        record({ operation: 'fetch', source, code: errorCode(error) })
        throw error
      }
    }
    const originalRead = ReadableStreamDefaultReader.prototype.read
    ReadableStreamDefaultReader.prototype.read = async function () {
      try {
        return await Reflect.apply(originalRead, this, arguments)
      } catch (error) {
        failed('body-read', error)
        throw error
      }
    }
    const originalFiles = new Map()
    for (const operation of [
      'mkdir',
      'mkdtemp',
      'open',
      'cp',
      'rename',
      'rm',
      'readdir',
      'lstat',
      'statfs',
      'writeFile',
      'rmdir',
      'chmod',
    ]) {
      const original = promises[operation]
      originalFiles.set(operation, original)
      promises[operation] = async function () {
        try {
          return await Reflect.apply(original, this, arguments)
        } catch (error) {
          failed(operation, error)
          throw error
        }
      }
    }
    const originalWriteStream = files.createWriteStream
    files.createWriteStream = function () {
      const stream = Reflect.apply(originalWriteStream, this, arguments)
      stream.once('error', (error) => failed('file-write-stream', error))
      return stream
    }
    const originalSpawn = ChildProcess.prototype.spawn
    ChildProcess.prototype.spawn = function (options) {
      const result = Reflect.apply(originalSpawn, this, arguments)
      const operation =
        options.file === '/usr/bin/hdiutil'
          ? options.args.includes('attach')
            ? 'dmg-attach'
            : 'dmg-detach'
          : options.args.includes('--version')
            ? 'version-probe'
            : undefined
      if (operation) {
        this.once('exit', (exitCode, signal) =>
          record({
            operation,
            exitCode: Number.isInteger(exitCode) ? exitCode : null,
            signal:
              signal === null
                ? null
                : ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'SIGILL'].includes(signal)
                  ? signal
                  : 'OTHER_SIGNAL',
          }),
        )
        this.once('error', (error) => failed(operation, error))
      }
      return result
    }
    modules.syncBuiltinESMExports()
    globalThis.__cwKernelDiagnostics = {
      records,
      restore() {
        globalThis.fetch = originalFetch
        ReadableStreamDefaultReader.prototype.read = originalRead
        for (const [operation, original] of originalFiles) promises[operation] = original
        files.createWriteStream = originalWriteStream
        ChildProcess.prototype.spawn = originalSpawn
        modules.syncBuiltinESMExports()
      },
    }
  })
}

export async function readKernelDiagnostics(desktop) {
  return desktop.evaluate(() => globalThis.__cwKernelDiagnostics?.records ?? [])
}

export async function restoreKernelDiagnostics(desktop) {
  await desktop
    .evaluate(() => {
      globalThis.__cwKernelDiagnostics?.restore()
      delete globalThis.__cwKernelDiagnostics
    })
    .catch(() => {})
}
