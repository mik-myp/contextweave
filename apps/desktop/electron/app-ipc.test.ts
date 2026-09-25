import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppHandlers } from './app-ipc'

function fixture() {
  const options = {
    getInfo: vi.fn(() => ({
      name: 'ContextWeave',
      version: '0.1.6',
      platform: 'darwin' as const,
      arch: 'arm64' as const,
      secureStorageAvailable: true,
    })),
    getPaths: vi.fn(() => ({
      userData: '/fixture',
      dataRoot: '/fixture/data',
      environmentRoot: '/fixture/environments',
      kernelRoot: '/fixture/kernels',
      logRoot: '/fixture/logs',
    })),
    quit: vi.fn(),
    openExternal: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
  }
  return { ...options, handlers: createAppHandlers(options) }
}
beforeEach(() => vi.clearAllMocks())

describe('application shell IPC', () => {
  it.each(['app:get-info', 'app:get-paths', 'app:quit'] as const)(
    '%s refuses unexpected input without reading data or scheduling side effects',
    async (channel) => {
      const f = fixture()
      for (const input of [null, {}, '/private', ['unexpected']])
        expect(f.handlers[channel](input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(f.getInfo).not.toHaveBeenCalled()
      expect(f.getPaths).not.toHaveBeenCalled()
      expect(f.quit).not.toHaveBeenCalled()
    },
  )

  it('returns typed information and defers a valid quit until after its response', async () => {
    const f = fixture()
    expect(f.handlers['app:get-info'](undefined)).toEqual({ ok: true, data: f.getInfo() })
    expect(f.handlers['app:get-paths'](undefined)).toEqual({ ok: true, data: f.getPaths() })
    expect(f.handlers['app:quit'](undefined)).toEqual({ ok: true, data: true })
    expect(f.quit).not.toHaveBeenCalled()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.quit).toHaveBeenCalledOnce()
  })

  it.each([
    'file:///private/secret',
    'javascript:alert(1)',
    'data:text/html,untrusted',
    'mailto:someone@example.test',
    'https://user:secret@example.test/',
    'https://example.test/' + 'x'.repeat(8192),
    'not a URL',
    null,
  ])('does not pass unsafe external URL %s to the OS', async (url) => {
    const f = fixture()
    expect(await f.handlers['app:open-external'](url)).toMatchObject({
      ok: false,
      code: 'INVALID_URL',
    })
    expect(f.openExternal).not.toHaveBeenCalled()
  })

  it('reports external-open failures without leaking the OS error or claiming success', async () => {
    const f = fixture()
    expect(await f.handlers['app:open-external']('https://example.test/help')).toEqual({
      ok: true,
      data: true,
    })
    f.openExternal.mockRejectedValue(new Error('private OS detail'))
    expect(await f.handlers['app:open-external']('https://example.test/help')).toEqual({
      ok: false,
      code: 'COMMAND_FAILED',
      message: 'COMMAND_FAILED',
    })
  })
})
