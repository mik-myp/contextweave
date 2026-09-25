import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectBrowserSettings, prepareBrowserProfile } from './browser-settings'
vi.mock('ws', () => ({
  default: class {
    constructor(url: string, options: unknown) {
      return Reflect.construct(globalThis.WebSocket, [url, options])
    }
  },
}))
const access = { port: 9222, token: 'a'.repeat(64) }

type Command = { id: number; method: string; params: Record<string, unknown>; sessionId?: string }
class MockSocket extends EventTarget {
  static instance: MockSocket
  commands: Command[] = []
  rejectTimezone = false
  constructor() {
    super()
    MockSocket.instance = this
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }
  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
  send(text: string) {
    const command: Command = JSON.parse(text)
    this.commands.push(command)
    queueMicrotask(() => {
      if (command.method === 'Target.setAutoAttach' && !command.sessionId)
        this.emit({
          method: 'Target.attachedToTarget',
          params: { sessionId: 'page-1', targetInfo: { type: 'page' } },
        })
      this.emit({
        id: command.id,
        ...(command.method === 'Emulation.setTimezoneOverride' && this.rejectTimezone
          ? { error: { message: 'Invalid timezone' } }
          : { result: {} }),
      })
    })
  }
  close() {
    this.dispatchEvent(new Event('close'))
  }
}
const settings = {
  language: 'en-GB',
  timezone: 'Europe/London',
  window: { width: 1440, height: 900 },
}
const directories: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
function mockCdp() {
  vi.stubGlobal('WebSocket', MockSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test' }),
    }),
  )
}

describe('browser settings runtime', () => {
  it('preserves unrelated profile preferences and removes a language override for system mode', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cw-language-'))
    directories.push(directory)
    mkdirSync(join(directory, 'Default'))
    const path = join(directory, 'Default', 'Preferences')
    writeFileSync(
      path,
      JSON.stringify({
        intl: { selected_languages: 'original' },
        browser: { check_default_browser: false },
      }),
    )
    prepareBrowserProfile(directory, 'en-GB')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      intl: { selected_languages: 'original', accept_languages: 'en-GB,en' },
      browser: { check_default_browser: false },
      session: { restore_on_startup: 1 },
      background_mode: { enabled: false },
    })
    prepareBrowserProfile(directory, 'system')
    expect(JSON.parse(readFileSync(path, 'utf8')).intl).toEqual({ selected_languages: 'original' })
  })
  it('leaves system settings to the browser without opening a control connection', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const close = await connectBrowserSettings(
      access,
      { ...settings, language: 'system', timezone: 'system' },
      vi.fn(),
    )
    close()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('applies settings before resuming existing and future targets, and reports lost connections once', async () => {
    mockCdp()
    const failure = vi.fn()
    const close = await connectBrowserSettings(access, settings, failure)
    const socket = MockSocket.instance
    expect(
      socket.commands
        .filter((command) => command.sessionId === 'page-1')
        .map((command) => command.method),
    ).toEqual([
      'Target.setAutoAttach',
      'Emulation.setTimezoneOverride',
      'Emulation.setLocaleOverride',
      'Runtime.runIfWaitingForDebugger',
    ])
    socket.emit({
      method: 'Target.attachedToTarget',
      params: { sessionId: 'iframe-1', targetInfo: { type: 'iframe' } },
    })
    await vi.waitFor(() =>
      expect(
        socket.commands.some(
          (command) =>
            command.sessionId === 'iframe-1' &&
            command.method === 'Runtime.runIfWaitingForDebugger',
        ),
      ).toBe(true),
    )
    socket.close()
    expect(failure).toHaveBeenCalledTimes(1)
    close()
    expect(failure).toHaveBeenCalledTimes(1)
  })
  it('fails startup if a browser rejects the requested timezone', async () => {
    mockCdp()
    const original = MockSocket.prototype.send
    vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (
      this: MockSocket,
      text: string,
    ) {
      this.rejectTimezone = true
      original.call(this, text)
    })
    const failure = vi.fn()
    await expect(connectBrowserSettings(access, settings, failure)).rejects.toThrow(
      'Invalid timezone',
    )
    vi.restoreAllMocks()
    expect(failure).not.toHaveBeenCalled()
  })
})

it('only supplies credentials to the configured proxy, never an origin, and cancels repeated challenges', async () => {
  mockCdp()
  const close = await connectBrowserSettings(access, settings, vi.fn(), {
    host: '127.0.0.1',
    port: 8080,
    username: 'fixture-user',
    password: 'fixture-password',
  })
  const socket = MockSocket.instance
  const challenge = (requestId: string, source: string, origin: string) =>
    socket.emit({
      method: 'Fetch.authRequired',
      sessionId: 'page-1',
      params: { requestId, authChallenge: { source, origin } },
    })
  challenge('origin', 'Server', 'https://example.test')
  challenge('wrong', 'Proxy', 'http://different.test:8080')
  challenge('proxy', 'Proxy', 'http://127.0.0.1:8080')
  challenge('proxy', 'Proxy', 'http://127.0.0.1:8080')
  await Promise.resolve()
  const responses = socket.commands
    .filter((command) => command.method === 'Fetch.continueWithAuth')
    .map((command) => command.params.authChallengeResponse)
  expect(responses).toEqual([
    { response: 'Default' },
    { response: 'Default' },
    { response: 'ProvideCredentials', username: 'fixture-user', password: 'fixture-password' },
    { response: 'CancelAuth' },
  ])
  close()
})

it('stops only after the last top-level page disappears, not during a short tab replacement', async () => {
  mockCdp()
  const original = MockSocket.prototype.send
  let targets = [{ targetId: 'tab-a', type: 'page' }]
  vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (
    this: MockSocket,
    text: string,
  ) {
    const command: Command = JSON.parse(text)
    if (command.method === 'Target.getTargets') {
      queueMicrotask(() => this.emit({ id: command.id, result: { targetInfos: targets } }))
      return
    }
    original.call(this, text)
  })
  const empty = vi.fn(),
    fail = vi.fn()
  const close = await connectBrowserSettings(
    access,
    { ...settings, language: 'system', timezone: 'system' },
    fail,
    undefined,
    empty,
  )
  try {
    const socket = MockSocket.instance
    expect(socket.commands.some((command) => command.method === 'Target.setAutoAttach')).toBe(false)
    expect(socket.commands.some((command) => command.method.startsWith('Emulation.'))).toBe(false)
    targets = []
    socket.emit({ method: 'Target.targetDestroyed', params: { targetId: 'tab-a' } })
    targets = [{ targetId: 'tab-b', type: 'page' }]
    socket.emit({ method: 'Target.targetCreated', params: { targetInfo: targets[0] } })
    await new Promise((resolve) => setTimeout(resolve, 850))
    expect(empty).not.toHaveBeenCalled()
    targets = []
    socket.emit({ method: 'Target.targetDestroyed', params: { targetId: 'tab-b' } })
    await vi.waitFor(() => expect(empty).toHaveBeenCalledOnce(), { timeout: 1500 })
    expect(fail).not.toHaveBeenCalled()
  } finally {
    close()
    vi.restoreAllMocks()
  }
})

it('uses explicit request-stage HTTP patterns; authentication never waits for page response bodies', async () => {
  mockCdp()
  const failure = vi.fn()
  const close = await connectBrowserSettings(access, settings, failure, {
    username: 'u',
    password: 'p',
    host: '127.0.0.1',
    port: 8080,
  })
  try {
    expect(
      MockSocket.instance.commands.find((command) => command.method === 'Fetch.enable')?.params,
    ).toEqual({
      handleAuthRequests: true,
      patterns: [
        { urlPattern: 'http://*', requestStage: 'Request' },
        { urlPattern: 'https://*', requestStage: 'Request' },
      ],
    })
    MockSocket.instance.emit({
      method: 'Fetch.requestPaused',
      sessionId: 'page-1',
      params: { requestId: 'slow' },
    })
    await Promise.resolve()
    expect(
      MockSocket.instance.commands.some((command) => command.method === 'Fetch.continueRequest'),
    ).toBe(true)
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(60000) // No response from the website is necessary for control health.
    expect(failure).not.toHaveBeenCalled()
  } finally {
    close()
    vi.useRealTimers()
  }
})

it('ignores a cancelled request ID but does not hide a real authentication/control error', async () => {
  mockCdp()
  const failure = vi.fn()
  const close = await connectBrowserSettings(access, settings, failure)
  const original = MockSocket.prototype.send
  let error = 'Invalid InterceptionId.'
  vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (
    this: MockSocket,
    text: string,
  ) {
    const command: Command = JSON.parse(text)
    if (command.method === 'Fetch.continueRequest') {
      queueMicrotask(() => this.emit({ id: command.id, error: { message: error } }))
    } else original.call(this, text)
  })
  try {
    const paused = () =>
      MockSocket.instance.emit({
        method: 'Fetch.requestPaused',
        sessionId: 'page-1',
        params: { requestId: 'cancelled' },
      })
    paused()
    await Promise.resolve()
    await Promise.resolve()
    expect(failure).not.toHaveBeenCalled()
    error = 'Unexpected control failure'
    paused()
    await Promise.resolve()
    await Promise.resolve()
    expect(failure).toHaveBeenCalledOnce()
  } finally {
    close()
    vi.restoreAllMocks()
  }
})

it('settles pending commands when their target detaches instead of failing the whole runtime', async () => {
  mockCdp()
  const failure = vi.fn()
  const close = await connectBrowserSettings(access, settings, failure)
  const original = MockSocket.prototype.send
  vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (
    this: MockSocket,
    text: string,
  ) {
    const command: Command = JSON.parse(text)
    if (command.method === 'Fetch.continueRequest') return
    original.call(this, text)
  })
  vi.useFakeTimers()
  try {
    MockSocket.instance.emit({
      method: 'Fetch.requestPaused',
      sessionId: 'page-1',
      params: { requestId: 'closing' },
    })
    MockSocket.instance.emit({
      method: 'Target.detachedFromTarget',
      params: { sessionId: 'page-1' },
    })
    await vi.advanceTimersByTimeAsync(6000)
    expect(failure).not.toHaveBeenCalled()
  } finally {
    close()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('cancels during configuration without reporting a runtime failure or leaving pending timers', async () => {
  mockCdp()
  const original = MockSocket.prototype.send
  vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (
    this: MockSocket,
    text: string,
  ) {
    const command: Command = JSON.parse(text)
    if (command.method === 'Emulation.setTimezoneOverride') {
      this.commands.push(command)
      return
    }
    original.call(this, text)
  })
  const controller = new AbortController(),
    failure = vi.fn()
  const opening = connectBrowserSettings(
    access,
    settings,
    failure,
    undefined,
    undefined,
    controller.signal,
  )
  const rejected = expect(opening).rejects.toThrow()
  await vi.waitFor(() =>
    expect(
      MockSocket.instance.commands.some(
        (command) => command.method === 'Emulation.setTimezoneOverride',
      ),
    ).toBe(true),
  )
  controller.abort()
  await rejected
  expect(failure).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it('still fails a genuinely unresponsive control command within a bounded deadline', async () => {
  mockCdp()
  const original = MockSocket.prototype.send
  vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (
    this: MockSocket,
    text: string,
  ) {
    if (JSON.parse(text).method === 'Emulation.setTimezoneOverride') return
    original.call(this, text)
  })
  vi.useFakeTimers()
  try {
    const opening = connectBrowserSettings(access, settings, vi.fn())
    const failure = expect(opening).rejects.toThrow(
      'command timed out: Emulation.setTimezoneOverride',
    )
    await vi.advanceTimersByTimeAsync(5100)
    await failure
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})
