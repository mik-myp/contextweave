// Failure evidence for the disposable Electron smoke host. This changes neither launch
// arguments/stdio nor the control transport, and never reads command or response bodies.
export async function installRuntimeDiagnostics(desktop) {
  await desktop.evaluate(() => {
    const children = process.getBuiltinModule('node:child_process')
    const modules = process.getBuiltinModule('node:module')
    const { basename } = process.getBuiltinModule('node:path')
    const original = children.spawn
    const records = []
    children.spawn = function (file, args, options) {
      const child = Reflect.apply(original, this, arguments)
      if (!Array.isArray(args) || !args.includes('--remote-debugging-pipe') || records.length >= 8)
        return child
      const since = performance.now()
      const record = {
        executable: basename(String(file)),
        pid: child.pid,
        controlArguments: args.filter((arg) => arg.startsWith('--remote-debugging-')),
        stdio: options.stdio,
        inputWritable: Boolean(child.stdio[3]?.writable),
        outputReadable: Boolean(child.stdio[4]?.readable),
        sentBytes: 0,
        receivedBytes: 0,
        firstWriteMs: null,
        firstReadMs: null,
        pipeError: null,
        exit: null,
      }
      records.push(record)
      const input = child.stdio[3],
        output = child.stdio[4]
      if (input) {
        const write = input.write
        input.write = function (chunk) {
          record.sentBytes +=
            typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
          record.firstWriteMs ??= Math.round(performance.now() - since)
          return Reflect.apply(write, this, arguments)
        }
      }
      if (output) {
        // Observing emit does not switch a paused pipe into flowing mode, unlike on('data').
        const emit = output.emit
        output.emit = function (name, value) {
          if (name === 'data') {
            record.receivedBytes += value.byteLength
            record.firstReadMs ??= Math.round(performance.now() - since)
          } else if (name === 'error')
            record.pipeError = /^[A-Z_]+$/.test(value?.code) ? value.code : 'STREAM_ERROR'
          return Reflect.apply(emit, this, arguments)
        }
      }
      child.once('exit', (code, signal) => {
        record.exit = { code, signal, afterMs: Math.round(performance.now() - since) }
      })
      return child
    }
    modules.syncBuiltinESMExports()
    // This exists only in the inspector-controlled smoke Main, never in shipped application code.
    globalThis.__cwRuntimeDiagnostics = {
      records,
      restore: () => {
        children.spawn = original
        modules.syncBuiltinESMExports()
      },
    }
  })
}
export async function readRuntimeDiagnostics(desktop) {
  return desktop.evaluate(() => globalThis.__cwRuntimeDiagnostics?.records ?? [])
}
export async function restoreRuntimeDiagnostics(desktop) {
  await desktop
    .evaluate(() => {
      globalThis.__cwRuntimeDiagnostics?.restore()
      delete globalThis.__cwRuntimeDiagnostics
    })
    .catch(() => {})
}
