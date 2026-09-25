// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { unwrapIpc } from './ipc'
import { errorMessage } from './error-message'

afterEach(() => {
  document.documentElement.lang = 'zh-CN'
})
it('keeps successful data and translates known failure codes, never raw messages', async () => {
  await expect(
    unwrapIpc(Promise.resolve({ ok: true, data: { version: '0.1.7' } })),
  ).resolves.toEqual({ version: '0.1.7' })
  await expect(
    unwrapIpc(Promise.resolve({ ok: false, code: 'PROXY_MISSING', message: 'password=private' })),
  ).rejects.toThrow(errorMessage('PROXY_MISSING'))
})
it('does not show an unknown server message as a UI fallback', async () => {
  await expect(
    unwrapIpc(
      Promise.resolve({
        ok: false,
        code: 'UNKNOWN_FAILURE',
        message: '/private/profile?password=secret',
      }),
    ),
  ).rejects.toThrow(errorMessage('COMMAND_FAILED'))
})
it.each(['zh-CN', 'en-US'])('sanitizes rejected bridge promises in %s', async (locale) => {
  document.documentElement.lang = locale
  await expect(
    unwrapIpc(Promise.reject(new Error('https://user:secret@proxy.test'))),
  ).rejects.toThrow(errorMessage('IPC_UNAVAILABLE'))
})
