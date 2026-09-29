// Failure evidence for the disposable Electron smoke host. This changes neither launch
// arguments/stdio nor the control transport, and never reads command or response bodies.
export async function installRuntimeDiagnostics(desktop) {
  await desktop.evaluate(({ app }) => {
    const children = process.getBuiltinModule('node:child_process')
    const modules = process.getBuiltinModule('node:module')
    const { basename, join } = process.getBuiltinModule('node:path')
    const { WebSocket } = modules.createRequire(join(app.getAppPath(), 'package.json'))('ws')
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
        // Keep only the two launch flags this smoke explicitly audits; never
        // expose profile paths, proxy credentials, URLs, or arbitrary argv.
        auditedLaunchArguments: args.filter((arg) =>
          arg === '--host-resolver-rules' || arg === '--test-type',
        ),
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
    const controlEvents = []
    const connections = new WeakMap()
    let connectionSequence = 0
    const started = performance.now()
    const originalEmit = WebSocket.prototype.emit
    const originalSend = WebSocket.prototype.send
    const connection = (socket) => {
      if (
        typeof socket.url !== 'string' ||
        !/^ws:\/\/127\.0\.0\.1:\d+\/contextweave\/browser$/.test(socket.url)
      )
        return undefined
      let state = connections.get(socket)
      if (!state) {
        state = { id: ++connectionSequence, methods: new Map() }
        connections.set(socket, state)
      }
      return state
    }
    const recordEvent = (state, event) => {
      if (state && controlEvents.length < 200)
        controlEvents.push({
          atMs: Math.round(performance.now() - started),
          connection: state.id,
          ...event,
        })
    }
    const parse = (data) => {
      if ((typeof data !== 'string' && !Buffer.isBuffer(data)) || Buffer.byteLength(data) > 65536)
        return undefined
      try {
        return JSON.parse(data.toString())
      } catch {
        return undefined
      }
    }
    const allowedMethods = new Set([
      'Target.attachToBrowserTarget',
      'Target.attachToTarget',
      'Target.detachFromTarget',
      'Target.setAutoAttach',
      'Target.setDiscoverTargets',
      'Target.getTargets',
      'Target.attachedToTarget',
      'Target.detachedFromTarget',
      'Target.targetCreated',
      'Target.targetDestroyed',
      'Target.targetInfoChanged',
      'Target.targetCrashed',
      'Runtime.runIfWaitingForDebugger',
      'Emulation.setTimezoneOverride',
      'Emulation.setLocaleOverride',
      'Fetch.enable',
      'Fetch.requestPaused',
      'Fetch.authRequired',
      'Fetch.continueRequest',
      'Fetch.continueWithAuth',
    ])
    const methodName = (name) => (allowedMethods.has(name) ? name : undefined)
    WebSocket.prototype.send = function (data) {
      const state = connection(this)
      if (state && state.methods.size < 128) {
        const message = parse(data)
        const method = methodName(message?.method)
        if (Number.isSafeInteger(message?.id) && method) state.methods.set(message.id, method)
      }
      return Reflect.apply(originalSend, this, arguments)
    }
    WebSocket.prototype.emit = function (event, data) {
      const state = connection(this)
      if (state && controlEvents.length < 200) {
        if (event === 'close')
          recordEvent(state, { event, code: typeof data === 'number' ? data : null })
        else if (event === 'error')
          recordEvent(state, {
            event,
            code: /^[A-Z_]{1,64}$/.test(data?.code) ? data.code : 'TRANSPORT_ERROR',
          })
        else if (event === 'message') {
          const message = parse(data)
          if (message) {
            const method = state.methods.get(message.id) ?? methodName(message.method)
            if (message.id !== undefined) state.methods.delete(message.id)
            const knownErrors = [
              'Session with given id not found.',
              'No session with given id',
              'Browser target detached',
              'CONTROL_SESSION',
              'CONTROL_CLOSED',
              'CONTROL_TIMEOUT',
            ]
            recordEvent(state, {
              event: message.id !== undefined ? 'response' : 'event',
              method,
              errorCode: typeof message.error?.code === 'number' ? message.error.code : undefined,
              errorKind: message.error
                ? knownErrors.includes(message.error.message)
                  ? message.error.message
                  : 'REDACTED_PROTOCOL_ERROR'
                : undefined,
              targetType: ['page', 'iframe', 'browser', 'service_worker', 'other'].includes(
                message.params?.targetInfo?.type,
              )
                ? message.params.targetInfo.type
                : undefined,
            })
          }
        }
      }
      return Reflect.apply(originalEmit, this, arguments)
    }
    // This exists only in the inspector-controlled smoke Main, never in shipped application code.
    globalThis.__cwRuntimeDiagnostics = {
      records,
      controlEvents,
      restore: () => {
        children.spawn = original
        WebSocket.prototype.emit = originalEmit
        WebSocket.prototype.send = originalSend
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

export async function readRuntimeFailureEvidence(desktop) {
  return desktop.evaluate(() => ({
    processes: globalThis.__cwRuntimeDiagnostics?.records ?? [],
    controlEvents: globalThis.__cwRuntimeDiagnostics?.controlEvents ?? [],
  }))
}

// The native retention smoke owns this synthetic cookie. Never return cookie text,
// domains, paths, expiry timestamps, or arbitrary browser response fields.
// Future expiry is an in-memory attribute, not proof of an on-disk commit.
export function summarizeFixtureCookie(cookies, nowSeconds = Date.now() / 1000) {
  const fixture = cookies.filter((cookie) => cookie.name === 'cw-cookie')
  const persistent = (cookie) => Number.isFinite(cookie.expires) && cookie.expires > nowSeconds
  const scoped = (cookie) => cookie.domain === '127.0.0.1' && cookie.path === '/'
  return {
    present: fixture.length > 0,
    expectedValue: fixture.some((cookie) => cookie.value === 'retained'),
    persistent: fixture.some(persistent),
    expectedScope: fixture.some(scoped),
    expectedPersistentCookie: fixture.some(
      (cookie) => cookie.value === 'retained' && scoped(cookie) && persistent(cookie),
    ),
  }
}
