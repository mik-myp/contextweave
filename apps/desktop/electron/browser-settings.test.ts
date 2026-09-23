import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectBrowserSettings, prepareBrowserLanguage } from './browser-settings'

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
    prepareBrowserLanguage(directory, 'en-GB')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      intl: { selected_languages: 'original', accept_languages: 'en-GB,en' },
      browser: { check_default_browser: false },
    })
    prepareBrowserLanguage(directory, 'system')
    expect(JSON.parse(readFileSync(path, 'utf8')).intl).toEqual({ selected_languages: 'original' })
  })
  it('leaves system settings to the browser without opening a control connection', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const close = await connectBrowserSettings(
      9222,
      { ...settings, language: 'system', timezone: 'system' },
      vi.fn(),
    )
    close()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('applies settings before resuming existing and future targets, and reports lost connections once', async () => {
    mockCdp()
    const failure = vi.fn()
    const close = await connectBrowserSettings(9222, settings, failure)
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
    await expect(connectBrowserSettings(9222, settings, failure)).rejects.toThrow(
      'Invalid timezone',
    )
    vi.restoreAllMocks()
    expect(failure).not.toHaveBeenCalled()
  })
})

it('only supplies credentials to the configured proxy, never an origin, and cancels repeated challenges', async () => {
  mockCdp()
  const close = await connectBrowserSettings(9222, settings, vi.fn(), {
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
