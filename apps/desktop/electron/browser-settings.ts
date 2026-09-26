import WebSocket from 'ws'
import { browserControlUrl, type BrowserControlAccess } from './services/browser-control-access'
import { z } from 'zod'
import type { BrowserSettings } from '@contextweave/contracts'

export { prepareBrowserProfile } from './services/browser-profile'

const messageSchema = z.object({
  id: z.number().optional(),
  sessionId: z.string().optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ message: z.string() }).optional(),
})
const attachedSchema = z.object({
  sessionId: z.string(),
  targetInfo: z.object({ type: z.string() }),
})
const autoAttach = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
  filter: [{ type: 'page' }, { type: 'iframe' }, { exclude: true }],
}

type PendingCommand = {
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  sessionId?: string
}

/** Keep a CDP session for settings on existing pages, new tabs and cross-origin frames. */
export async function connectBrowserSettings(
  access: BrowserControlAccess,
  settings: BrowserSettings,
  onFailure: (error: Error) => void,
  proxy?: { username: string; password: string; host: string; port: number },
  onNoPages?: () => void,
  signal?: AbortSignal,
  startupDeadline?: number,
): Promise<() => void> {
  signal?.throwIfAborted()
  if (settings.language === 'auto' || settings.timezone === 'auto')
    throw new Error('IP_LOCALE_FAILED')
  const needsOverrides = !!proxy || settings.language !== 'system' || settings.timezone !== 'system'
  if (!needsOverrides && !onNoPages) return () => {}
  const socket = new WebSocket(browserControlUrl(access), {
    headers: { Authorization: `Bearer ${access.token}` },
    handshakeTimeout: 5000,
    maxPayload: 64 * 1024 * 1024,
    perMessageDeflate: false,
  })
  const pending = new Map<number, PendingCommand>()
  const attached = new Set<string>()
  const initializing = new Set<Promise<void>>()
  const authAttempts = new Set<string>()
  let sequence = 0
  let closed = false
  let ready = false
  let failure: Error | undefined
  const pages = new Set<string>()
  let sawPage = false
  let emptyTimer: ReturnType<typeof setTimeout> | undefined
  const targetSchema = z.object({
    targetId: z.string(),
    type: z.string(),
    subtype: z.string().optional(),
  })
  const isPage = (target: z.infer<typeof targetSchema>) =>
    target.type === 'page' && target.subtype !== 'prerender'
  const checkEmpty = () => {
    clearTimeout(emptyTimer)
    if (!onNoPages || !ready || !sawPage || pages.size || closed) return
    emptyTimer = setTimeout(() => {
      void send('Target.getTargets', {})
        .then((result) => {
          if (closed || pages.size) return
          const targets = z.object({ targetInfos: z.array(targetSchema) }).parse(result).targetInfos
          if (!targets.some(isPage)) onNoPages()
        })
        .catch(fail)
    }, 750)
  }
  const close = () => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', close)
    clearTimeout(emptyTimer)
    try {
      socket.close()
    } catch {
      /* Connecting sockets may already be closing. */
    }
    for (const command of pending.values()) {
      clearTimeout(command.timer)
      command.reject(new Error('Browser settings connection closed'))
    }
    pending.clear()
    attached.clear()
    authAttempts.clear()
  }
  signal?.addEventListener('abort', close, { once: true })
  if (signal?.aborted) close()
  const fail = (cause: unknown) => {
    if (closed) return
    failure = cause instanceof Error ? cause : new Error('Browser settings could not be applied')
    close()
    if (ready) onFailure(failure)
  }
  const send = (method: string, params: Record<string, unknown>, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      if (closed || (sessionId && !attached.has(sessionId))) {
        reject(new Error('Browser settings connection closed'))
        return
      }
      const timeoutMs =
        !ready && startupDeadline !== undefined ? startupDeadline - performance.now() : 5000
      if (timeoutMs <= 0) {
        reject(new Error(`Browser settings command timed out: ${method}`))
        return
      }
      const id = ++sequence
      const timer = setTimeout(() => {
        // Timers can run before queued socket messages after a busy main-loop turn.
        setImmediate(() => {
          if (!pending.delete(id)) return
          reject(new Error(`Browser settings command timed out: ${method}`))
        })
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer, sessionId })
      try {
        socket.send(JSON.stringify({ id, method, params, sessionId }))
      } catch (cause) {
        clearTimeout(timer)
        pending.delete(id)
        reject(cause instanceof Error ? cause : new Error('Browser settings command failed'))
      }
    })
  const configure = async (sessionId: string) => {
    try {
      // Pause future targets until overrides are in place; do not patch page JavaScript.
      await send('Target.setAutoAttach', autoAttach, sessionId)
      if (settings.timezone !== 'system')
        await send('Emulation.setTimezoneOverride', { timezoneId: settings.timezone }, sessionId)
      if (settings.language !== 'system')
        await send('Emulation.setLocaleOverride', { locale: settings.language }, sessionId)
      if (proxy)
        await send(
          'Fetch.enable',
          {
            // Chromium rejects empty patterns when auth is enabled. Request-stage ACKs
            // do not wait for the remote response; never intercept the response body.
            patterns: [
              { urlPattern: 'http://*', requestStage: 'Request' },
              { urlPattern: 'https://*', requestStage: 'Request' },
            ],
            handleAuthRequests: true,
          },
          sessionId,
        )
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId)
    } catch (cause) {
      // Closing a tab during setup is normal; other failures invalidate this runtime.
      if (attached.has(sessionId)) fail(cause)
    }
  }
  const requestFailure = (sessionId: string, cause: unknown) => {
    if (!attached.has(sessionId) || closed) return
    // Navigation/cancellation can invalidate a request before its continuation arrives.
    if (
      cause instanceof Error &&
      /^(Invalid InterceptionId|Invalid RequestId|Invalid state for continueInterceptedRequest)\.?$/.test(
        cause.message,
      )
    )
      return
    fail(cause)
  }
  socket.addEventListener('message', (event) => {
    if (closed) return
    try {
      if (typeof event.data !== 'string') throw new Error('Invalid browser settings response')
      const message = messageSchema.parse(JSON.parse(event.data))
      if (message.id !== undefined) {
        const command = pending.get(message.id)
        if (!command) return
        clearTimeout(command.timer)
        pending.delete(message.id)
        if (message.error) command.reject(new Error(message.error.message))
        else command.resolve(message.result ?? {})
      } else if (
        onNoPages &&
        ['Target.targetCreated', 'Target.targetInfoChanged'].includes(message.method ?? '')
      ) {
        const { targetInfo } = z.object({ targetInfo: targetSchema }).parse(message.params)
        if (isPage(targetInfo)) {
          pages.add(targetInfo.targetId)
          sawPage = true
          clearTimeout(emptyTimer)
        }
      } else if (onNoPages && message.method === 'Target.targetDestroyed') {
        const { targetId } = z.object({ targetId: z.string() }).parse(message.params)
        pages.delete(targetId)
        checkEmpty()
      } else if (message.method === 'Target.attachedToTarget') {
        const target = attachedSchema.parse(message.params)
        attached.add(target.sessionId)
        const task = configure(target.sessionId)
        initializing.add(task)
        void task.finally(() => initializing.delete(task))
      } else if (message.method === 'Fetch.requestPaused' && message.sessionId) {
        const request = z.object({ requestId: z.string() }).parse(message.params)
        void send(
          'Fetch.continueRequest',
          { requestId: request.requestId },
          message.sessionId,
        ).catch((cause) => requestFailure(message.sessionId!, cause))
      } else if (message.method === 'Fetch.authRequired' && message.sessionId) {
        const request = z
          .object({
            requestId: z.string(),
            authChallenge: z.object({ source: z.string(), origin: z.string() }),
          })
          .parse(message.params)
        const key = `${message.sessionId}:${request.requestId}`
        let matchesProxy = false
        try {
          const origin = new URL(request.authChallenge.origin)
          matchesProxy =
            !!proxy &&
            request.authChallenge.source === 'Proxy' &&
            origin.hostname === proxy.host &&
            Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) === proxy.port
        } catch {
          /* Never provide credentials to an unrecognized challenge. */
        }
        const authorized = matchesProxy && !authAttempts.has(key) && authAttempts.size < 10000
        if (authorized) authAttempts.add(key)
        void send(
          'Fetch.continueWithAuth',
          {
            requestId: request.requestId,
            authChallengeResponse:
              authorized && proxy
                ? {
                    response: 'ProvideCredentials',
                    username: proxy.username,
                    password: proxy.password,
                  }
                : { response: matchesProxy ? 'CancelAuth' : 'Default' },
          },
          message.sessionId,
        ).catch((cause) => requestFailure(message.sessionId!, cause))
      } else if (message.method === 'Target.detachedFromTarget') {
        const detached = z.object({ sessionId: z.string() }).parse(message.params)
        attached.delete(detached.sessionId)
        for (const [id, command] of pending) {
          if (command.sessionId !== detached.sessionId) continue
          clearTimeout(command.timer)
          pending.delete(id)
          command.reject(new Error('Browser target detached'))
        }
        for (const key of authAttempts)
          if (key.startsWith(`${detached.sessionId}:`)) authAttempts.delete(key)
      }
    } catch (cause) {
      fail(cause)
    }
  })
  socket.addEventListener('close', () => fail(new Error('Browser settings connection lost')))
  socket.addEventListener('error', () => fail(new Error('Browser settings connection failed')))
  try {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Browser settings connection timed out')),
        5000,
      )
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('Browser settings connection failed'))
        },
        { once: true },
      )
      socket.addEventListener(
        'close',
        () => {
          clearTimeout(timer)
          reject(new Error('Browser settings connection closed'))
        },
        { once: true },
      )
    })
    if (onNoPages) {
      await send('Target.setDiscoverTargets', {
        discover: true,
        filter: [{ type: 'page' }, { exclude: true }],
      })
      const result = z
        .object({ targetInfos: z.array(targetSchema) })
        .parse(await send('Target.getTargets', {}))
      for (const target of result.targetInfos)
        if (isPage(target)) {
          pages.add(target.targetId)
          sawPage = true
        }
    }
    // A lifecycle-only observer must not attach/pause page execution or interfere
    // with independent Worker/Playwright CDP clients. Discovery alone is sufficient.
    if (needsOverrides) {
      await send('Target.setAutoAttach', autoAttach)
      while (initializing.size) await Promise.all([...initializing])
    }
    signal?.throwIfAborted()
    if (failure) throw failure
    ready = true
    checkEmpty()
    return close
  } catch (cause) {
    close()
    throw cause
  }
}
