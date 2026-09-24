import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyConfigSchema } from '@contextweave/contracts'
import { createIpLocalePreview } from './ip-locale-preview'
import { createIpLocaleService, parseIpLocale } from './ip-locale'
import { openProxyTransport } from './proxy-transport'
vi.mock('./proxy-transport', () => ({ openProxyTransport: vi.fn() }))
const result = parseIpLocale(
  JSON.stringify({
    success: true,
    ip: '203.0.113.1',
    country_code: 'US',
    timezone: { id: 'America/New_York' },
  }),
  'direct',
)
function fixture() {
  const repository = {
    getProxy: vi.fn().mockReturnValue({
      ...proxyConfigSchema.parse({
        type: 'socks5',
        host: 'proxy.invalid',
        port: 1080,
        credentialRef: 'secret-id',
      }),
      proxyId: 'saved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  }
  const credentials = { read: vi.fn().mockReturnValue('upstream-secret') }
  const locale = createIpLocaleService()
  const detect = vi.spyOn(locale, 'detect').mockResolvedValue(result)
  const close = vi.fn().mockResolvedValue(undefined)
  const auth = { host: '127.0.0.1', port: 8181, username: 'random', password: 'bridge-secret' }
  vi.mocked(openProxyTransport).mockResolvedValue({ authentication: auth, args: [], close })
  const preview = createIpLocalePreview(repository, credentials, locale)
  return { repository, credentials, detect, close, auth, preview }
}
afterEach(() => vi.clearAllMocks())
describe('locale preview routing and ownership', () => {
  it('does not load proxy credentials in direct mode', async () => {
    const f = fixture()
    await f.preview.detect({ requestId: randomUUID(), connection: 'direct' })
    expect(f.repository.getProxy).not.toHaveBeenCalled()
    expect(f.credentials.read).not.toHaveBeenCalled()
    expect(openProxyTransport).not.toHaveBeenCalled()
    expect(f.detect).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
  })
  it('binds saved proxy credentials, closes its bridge and never trusts renderer endpoints', async () => {
    const f = fixture()
    await f.preview.detect({ requestId: randomUUID(), connection: 'proxy', proxyId: 'saved' })
    expect(f.credentials.read).toHaveBeenCalledWith('secret-id')
    expect(f.detect).toHaveBeenCalledWith(f.auth, expect.any(AbortSignal))
    expect(f.close).toHaveBeenCalledOnce()
    expect(() =>
      f.preview.detect({
        requestId: randomUUID(),
        connection: 'proxy',
        proxyId: 'saved',
        host: 'attacker',
        credentialRef: 'secret-id',
      }),
    ).toThrow()
    expect(openProxyTransport).toHaveBeenCalledOnce()
  })
  it('does not fall back when the saved proxy or its secret is unavailable', async () => {
    const f = fixture()
    f.repository.getProxy.mockReturnValueOnce(undefined)
    await expect(
      f.preview.detect({ requestId: randomUUID(), connection: 'proxy', proxyId: 'missing' }),
    ).rejects.toThrow('PROXY_MISSING')
    f.credentials.read.mockReturnValueOnce(undefined)
    await expect(
      f.preview.detect({ requestId: randomUUID(), connection: 'proxy', proxyId: 'saved' }),
    ).rejects.toThrow('CREDENTIAL_UNAVAILABLE')
    expect(f.detect).not.toHaveBeenCalled()
    expect(openProxyTransport).not.toHaveBeenCalled()
  })
  it('only cancels the matching request, prevents duplicates and closes on shutdown', async () => {
    const f = fixture()
    f.detect.mockImplementation(
      (_auth, signal) =>
        new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true }),
        ),
    )
    const requestId = randomUUID()
    const pending = f.preview.detect({ requestId, connection: 'proxy', proxyId: 'saved' })
    const settled = expect(pending).rejects.toThrow('CANCELLED')
    await vi.waitFor(() => expect(f.detect).toHaveBeenCalled())
    expect(() => f.preview.detect({ requestId: randomUUID(), connection: 'direct' })).toThrow(
      'IP_LOCALE_BUSY',
    )
    expect(f.preview.cancel(randomUUID())).toBe(false)
    await f.preview.shutdown()
    await settled
    expect(f.close).toHaveBeenCalledOnce()
    expect(() => f.preview.detect({ requestId: randomUUID(), connection: 'direct' })).toThrow(
      'APP_CLOSING',
    )
  })
})
