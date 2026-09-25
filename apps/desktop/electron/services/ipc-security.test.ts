import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTrustedIpcSender, isTrustedRendererUrl } from './ipc-security'

const entry = 'http://127.0.0.1:5173/'
function fixture(url = entry) {
  const frame = { url }
  const contents = { mainFrame: frame, isDestroyed: () => false }
  const window = { webContents: contents, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: frame }
  return { window, event, frame, contents }
}

describe('trusted IPC sender', () => {
  it('accepts only the current main window and exact application entry including hash routes', () => {
    const { window, event } = fixture(`${entry}#/environments?name=demo`)
    expect(isTrustedIpcSender(event, window, entry, false)).toBe(true)
    const file = pathToFileURL(resolve('fixture with spaces', '中文', 'index.html')).href
    const packaged = fixture(`${file}#/settings`)
    expect(isTrustedIpcSender(packaged.event, packaged.window, file, false)).toBe(true)
  })

  it.each([
    'http://127.0.0.1:51730/',
    'http://127.0.0.1.attacker.invalid:5173/',
    'http://127.0.0.1:5173/other.html',
    'http://127.0.0.1:5173/?redirect=other',
    'http://user:password@127.0.0.1:5173/',
    'https://127.0.0.1:5173/',
    'about:blank',
    'data:text/html,untrusted',
    'not a URL',
  ])('rejects a main frame that navigated or redirected to %s', (url) => {
    const { window, event } = fixture(url)
    expect(isTrustedIpcSender(event, window, entry, false)).toBe(false)
  })

  it('rejects a different local file instead of trusting the shared null file origin', () => {
    const expected = pathToFileURL(resolve('app', 'index.html')).href
    expect(isTrustedRendererUrl(pathToFileURL(resolve('other', 'index.html')).href, expected)).toBe(
      false,
    )
    expect(isTrustedRendererUrl('javascript:alert(1)', 'javascript:alert(1)')).toBe(false)
  })

  it('rejects child frames, other windows, missing frames and destroyed references', () => {
    const { window, event, contents } = fixture()
    expect(
      isTrustedIpcSender({ ...event, senderFrame: { url: entry } }, window, entry, false),
    ).toBe(false)
    expect(isTrustedIpcSender({ ...event, sender: fixture().contents }, window, entry, false)).toBe(
      false,
    )
    expect(isTrustedIpcSender({ ...event, senderFrame: null }, window, entry, false)).toBe(false)
    expect(isTrustedIpcSender(event, undefined, entry, false)).toBe(false)
    expect(isTrustedIpcSender(event, { ...window, isDestroyed: () => true }, entry, false)).toBe(
      false,
    )
    contents.isDestroyed = () => true
    expect(isTrustedIpcSender(event, window, entry, false)).toBe(false)
  })

  it('fails closed during startup recovery, shutdown, or frame destruction', () => {
    const { window, event } = fixture()
    expect(isTrustedIpcSender(event, window, entry, true)).toBe(false)
    const detached = {
      ...event,
      get senderFrame(): never {
        throw new Error('Frame was disposed')
      },
    }
    expect(isTrustedIpcSender(detached, window, entry, false)).toBe(false)
  })
})
