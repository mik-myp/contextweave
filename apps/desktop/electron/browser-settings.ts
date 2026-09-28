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

export class BrowserSettingsError extends Error {
  constructor(
    readonly code:
      'BROWSER_CONTROL_TIMEOUT' | 'BROWSER_CONTROL_FAILED' | 'BROWSER_PROXY_CONTROL_FAILED',
    message: string,
  ) {
    super(message)
  }
}

type QueuedCommand = {
  sessionId?: string
  timer: ReturnType<typeof setTimeout>
  dispatch(): void
  reject(error: Error): void
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
  const needsOverrides = settings.language !== 'system' || settings.timezone !== 'system'
  if (!proxy && !needsOverrides && !onNoPages) return () => {}
  const socket = new WebSocket(browserControlUrl(access), {
    headers: { Authorization: `Bearer ${access.token}` },
    handshakeTimeout: 5000,
    maxPayload: 64 * 1024 * 1024,
    perMessageDeflate: false,
  })
  const pending = new Map<number, PendingCommand>()
  // The authenticated bridge admits 128 outstanding commands per client. A page can
  // pause hundreds of requests at once: queue locally instead of tripping its limit.
  const queued: QueuedCommand[] = []
  const drain = () => {
    while (!closed && pending.size < 32 && queued.length) {
      const command = queued.shift()!
      clearTimeout(command.timer)
      command.dispatch()
    }
  }
  const attached = new Set<string>()
  const parents = new Map<string, string>()
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
          if (!targets.some(isPage)) closeForNoPages()
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
    for (const command of queued.splice(0)) {
      clearTimeout(command.timer)
      command.reject(new Error('Browser settings connection closed'))
    }
    attached.clear()
    parents.clear()
    authAttempts.clear()
  }
  const closeForNoPages = () => {
    if (closed || !onNoPages) return
    close()
    // This requests the supervisor's normal stop path; only it can confirm OS exit.
    onNoPages()
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
      const dispatch = () => {
        if (closed || (sessionId && !attached.has(sessionId))) {
          reject(new Error('Browser target detached'))
          return
        }
        const timeoutMs =
          !ready && startupDeadline !== undefined ? startupDeadline - performance.now() : 5000
        const timeout = () =>
          new BrowserSettingsError(
            'BROWSER_CONTROL_TIMEOUT',
            `Browser settings command timed out: ${method}`,
          )
        if (timeoutMs <= 0) {
          reject(timeout())
          return
        }
        const id = ++sequence
        const timer = setTimeout(() => {
          // Give buffered replies a turn after a busy event loop.
          setImmediate(() => {
            if (!pending.delete(id)) return
            reject(timeout())
            queueMicrotask(drain)
          })
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer, sessionId })
        try {
          socket.send(JSON.stringify({ id, method, params, sessionId }))
        } catch (cause) {
          clearTimeout(timer)
          pending.delete(id)
          reject(cause instanceof Error ? cause : new Error('Browser settings command failed'))
          queueMicrotask(drain)
        }
      }
      if (pending.size < 32 && queued.length === 0) dispatch()
      else {
        if (queued.length >= 4096) {
          reject(new BrowserSettingsError('BROWSER_CONTROL_FAILED', 'Browser settings queue full'))
          return
        }
        const command: QueuedCommand = {
          sessionId,
          dispatch,
          reject,
          timer: setTimeout(
            () => {
              const index = queued.indexOf(command)
              if (index < 0) return
              queued.splice(index, 1)
              reject(
                new BrowserSettingsError(
                  'BROWSER_CONTROL_TIMEOUT',
                  'Browser settings queue timed out',
                ),
              )
            },
            !ready && startupDeadline !== undefined
              ? Math.max(0, startupDeadline - performance.now())
              : 30000,
          ),
        }
        queued.push(command)
      }
    })
  const override = async (
    method: 'Emulation.setTimezoneOverride' | 'Emulation.setLocaleOverride',
    params: Record<string, unknown>,
    sessionId: string,
  ) => {
    try {
      return await send(method, params, sessionId)
    } catch (cause) {
      // Chromium shares these overrides between targets in one renderer process.
      // Every target in this owned environment receives the same configuration.
      // A sibling's existing override is not a control failure; other errors still fail closed.
      const duplicate =
        method === 'Emulation.setLocaleOverride'
          ? 'Another locale override is already in effect'
          : 'Timezone override is already in effect'
      if (cause instanceof Error && cause.message === duplicate) return {}
      throw cause
    }
  }
  const configure = async (sessionId: string, type: string) => {
    try {
      // Pause future targets until overrides are in place; do not patch page JavaScript.
      await send('Target.setAutoAttach', autoAttach, sessionId)
      if (type === 'tab') return
      if (settings.timezone !== 'system')
        await override(
          'Emulation.setTimezoneOverride',
          { timezoneId: settings.timezone },
          sessionId,
        )
      if (settings.language !== 'system')
        await override('Emulation.setLocaleOverride', { locale: settings.language }, sessionId)
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId)
    } catch (cause) {
      // Closing a tab during setup is normal; other failures invalidate this runtime.
      if (attached.has(sessionId)) fail(cause)
    }
  }
  const requestFailure = (sessionId: string | undefined, cause: unknown) => {
    if ((sessionId && !attached.has(sessionId)) || closed) return
    // Navigation/cancellation can invalidate a request before its continuation arrives.
    if (
      cause instanceof Error &&
      /^(Invalid InterceptionId|Invalid RequestId|Invalid state for continueInterceptedRequest)\.?$/.test(
        cause.message,
      )
    )
      return
    fail(
      cause instanceof BrowserSettingsError
        ? cause
        : new BrowserSettingsError('BROWSER_PROXY_CONTROL_FAILED', 'Browser proxy control failed'),
    )
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
        queueMicrotask(drain)
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
        if (message.sessionId) parents.set(target.sessionId, message.sessionId)
        const task = configure(target.sessionId, target.targetInfo.type)
        initializing.add(task)
        void task.finally(() => initializing.delete(task))
      } else if (message.method === 'Fetch.requestPaused') {
        const request = z.object({ requestId: z.string() }).parse(message.params)
        void send(
          'Fetch.continueRequest',
          { requestId: request.requestId },
          message.sessionId,
        ).catch((cause) => requestFailure(message.sessionId, cause))
      } else if (message.method === 'Fetch.authRequired') {
        const request = z
          .object({
            requestId: z.string(),
            authChallenge: z.object({ source: z.string(), origin: z.string() }),
          })
          .parse(message.params)
        const key = `${message.sessionId ?? 'browser'}:${request.requestId}`
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
        ).catch((cause) => requestFailure(message.sessionId, cause))
      } else if (message.method === 'Target.detachedFromTarget') {
        const detached = z.object({ sessionId: z.string() }).parse(message.params)
        const removed = new Set([detached.sessionId])
        for (const parent of removed)
          for (const [child, owner] of parents) if (owner === parent) removed.add(child)
        for (const sessionId of removed) {
          attached.delete(sessionId)
          parents.delete(sessionId)
        }
        for (const [id, command] of pending) {
          if (!command.sessionId || !removed.has(command.sessionId)) continue
          clearTimeout(command.timer)
          pending.delete(id)
          command.reject(new Error('Browser target detached'))
        }
        for (let index = queued.length - 1; index >= 0; index--) {
          const command = queued[index]
          if (!command.sessionId || !removed.has(command.sessionId)) continue
          queued.splice(index, 1)
          clearTimeout(command.timer)
          command.reject(new Error('Browser target detached'))
        }
        queueMicrotask(drain)
        for (const key of authAttempts)
          if ([...removed].some((sessionId) => key.startsWith(`${sessionId}:`)))
            authAttempts.delete(key)
      }
    } catch (cause) {
      fail(cause)
    }
  })
  const connectionLost = (error: Error) => {
    if (closed) return
    // Chromium can drop CDP after destroying its last page, before the 750 ms
    // empty-page probe. Preserve observed close intent instead of reporting a
    // settings failure. Unknown/never-seen/still-live pages remain fail-closed.
    if (ready && sawPage && pages.size === 0 && onNoPages) closeForNoPages()
    else fail(error)
  }
  socket.addEventListener('close', () =>
    connectionLost(new Error('Browser settings connection lost')),
  )
  socket.addEventListener('error', () =>
    connectionLost(new Error('Browser settings connection failed')),
  )
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
    if (proxy) {
      // Browser-scoped Fetch also covers a target's very first navigation and
      // restored/background requests, before a page session can be configured.
      await send('Fetch.enable', {
        patterns: [
          { urlPattern: 'http://*', requestStage: 'Request' },
          { urlPattern: 'https://*', requestStage: 'Request' },
        ],
        handleAuthRequests: true,
      })
    }
    // A lifecycle-only observer must not attach/pause page execution or interfere
    // with independent Worker/Playwright CDP clients. Discovery alone is sufficient.
    if (needsOverrides) {
      // Attach the tab container before its renderer exists. Attaching page targets
      // directly can be too late to pause scripts during native session restoration.
      await send('Target.setAutoAttach', {
        ...autoAttach,
        filter: [{ type: 'tab' }, { exclude: true }],
      })
      while (initializing.size) await Promise.all([...initializing])
    }
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
