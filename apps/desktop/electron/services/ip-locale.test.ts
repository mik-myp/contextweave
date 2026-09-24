import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultCommonEnvironmentConfig } from '@contextweave/contracts'

vi.mock('node:https', () => ({ get: vi.fn() }))
import { get } from 'node:https'
import { applyIpLocale, createIpLocaleService, parseIpLocale, requestIpLocale } from './ip-locale'

const body = JSON.stringify({
  success: true,
  ip: '203.0.113.42',
  country_code: 'US',
  timezone: { id: 'America/New_York' },
})
const sample = parseIpLocale(body, 'direct')
const auth = { host: '127.0.0.1', port: 41801, username: 'bridge-user', password: 'bridge-secret' }
let status: number
let data: string
let request: EventEmitter & { destroy: ReturnType<typeof vi.fn> }
beforeEach(() => {
  status = 200
  data = body
  request = Object.assign(new EventEmitter(), { destroy: vi.fn() })
  vi.mocked(get).mockImplementation((_url, _options, callback) => {
    const response = Object.assign(new PassThrough(), { statusCode: status })
    queueMicrotask(() => {
      callback?.(response as unknown as import('node:http').IncomingMessage)
      response.end(data)
    })
    return request as unknown as import('node:http').ClientRequest
  })
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('IP region boundary', () => {
  it.each([
    ['US', 'en-US'],
    ['CN', 'zh-CN'],
    ['TW', 'zh-TW'],
    ['JP', 'ja-JP'],
    ['DE', 'de-DE'],
  ])('recommends CLDR language for %s', (country, language) => {
    expect(parseIpLocale(body.replace('"US"', `"${country}"`), 'direct').language).toBe(language)
  })
  it.each([
    '{}',
    '<html>unavailable</html>',
    body.replace('true', 'false'),
    body.replace('203.0.113.42', 'secret'),
    body.replace('America/New_York', 'system'),
    body.replace('America/New_York', 'auto'),
    body.replace('America/New_York', 'Mars/Olympus'),
    body.replace('"US"', '"ZZ"'),
    body.replace('"US"', '"AA"'),
  ])('rejects invalid or incomplete provider data %#', (invalid) => {
    expect(() => parseIpLocale(invalid, 'direct')).toThrow('IP_LOCALE_INVALID_RESPONSE')
  })
  it('preserves independent manual/system settings without changing the saved config', () => {
    const config = { ...defaultCommonEnvironmentConfig, language: 'system', timezone: 'auto' }
    expect(applyIpLocale(config, sample)).toMatchObject({
      language: 'system',
      timezone: sample.timezone,
    })
    expect(config.timezone).toBe('auto')
    expect(applyIpLocale({ ...config, language: 'auto', timezone: 'UTC' }, sample)).toMatchObject({
      language: 'en-US',
      timezone: 'UTC',
    })
  })
  it('uses the fixed HTTPS endpoint directly without bridge credentials', async () => {
    expect(await requestIpLocale(undefined, AbortSignal.timeout(1000))).toMatchObject({
      connection: 'direct',
      ip: sample.ip,
    })
    expect(get).toHaveBeenCalledWith(
      'https://ipwho.is/?fields=success,ip,country_code,timezone.id',
      expect.objectContaining({ agent: false, headers: { Accept: 'application/json' } }),
      expect.any(Function),
    )
  })
  it('uses an HTTPS tunnel through the supplied bridge, does not send secrets to the provider, and closes it', async () => {
    const result = await requestIpLocale(auth, AbortSignal.timeout(1000))
    expect(result.connection).toBe('proxy')
    const options = vi.mocked(get).mock.calls[0]![1] as import('node:https').RequestOptions
    expect(options.agent).not.toBe(false)
    expect(options.rejectUnauthorized).not.toBe(false)
    expect(JSON.stringify(options.headers)).not.toContain('secret')
    expect(vi.mocked(get).mock.calls[0]![0]).not.toContain('secret')
  })
  it.each([302, 403, 429, 500])(
    'does not follow redirects or retry directly for status %i',
    async (code) => {
      status = code
      await expect(requestIpLocale(auth, AbortSignal.timeout(1000))).rejects.toThrow(
        code === 429 ? 'IP_LOCALE_RATE_LIMITED' : 'IP_LOCALE_FAILED',
      )
      expect(get).toHaveBeenCalledOnce()
    },
  )
  it('bounds response bytes and discards network error details', async () => {
    data = 'x'.repeat(8193)
    await expect(requestIpLocale(auth, AbortSignal.timeout(1000))).rejects.toThrow(
      'IP_LOCALE_INVALID_RESPONSE',
    )
    expect(request.destroy).toHaveBeenCalledOnce()
    vi.mocked(get).mockImplementationOnce(() => {
      queueMicrotask(() => request.emit('error', new Error('proxy://user:secret@host')))
      return request as unknown as import('node:http').ClientRequest
    })
    await expect(requestIpLocale(auth, AbortSignal.timeout(1000))).rejects.toThrow(
      'IP_LOCALE_FAILED',
    )
  })
  it('cancels before connecting and never starts another route', async () => {
    await expect(requestIpLocale(auth, AbortSignal.abort())).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })
  it('bounds concurrency, aborts on shutdown, and does not reuse previous results', async () => {
    const handler = vi.fn(
      (_proxy, signal: AbortSignal) =>
        new Promise<typeof sample>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('private')), { once: true })
        }),
    )
    const service = createIpLocaleService(handler)
    const requests = [service.detect(), service.detect(auth), service.detect()]
    const settled = Promise.allSettled(requests)
    await expect(service.detect()).rejects.toThrow('IP_LOCALE_BUSY')
    await service.shutdown()
    expect(
      (await settled).every((r) => r.status === 'rejected' && r.reason.message === 'CANCELLED'),
    ).toBe(true)
    await expect(service.detect()).rejects.toThrow('APP_CLOSING')
    expect(handler).toHaveBeenCalledTimes(3)
    const success = vi.fn().mockResolvedValue(sample)
    const next = createIpLocaleService(success)
    await next.detect()
    await next.detect()
    expect(success).toHaveBeenCalledTimes(2)
  })
  it('maps the total deadline to a timeout rather than leaking the transport error', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    try {
      const service = createIpLocaleService(
        (_proxy, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('secret transport detail')), {
              once: true,
            })
          }),
      )
      const pending = service.detect(auth)
      const rejected = expect(pending).rejects.toThrow('IP_LOCALE_TIMEOUT')
      deadline.abort()
      await rejected
    } finally {
      timeout.mockRestore()
    }
  })
  it('maps provider failures, cancellation and stale successful completion safely', async () => {
    const abort = new AbortController()
    const service = createIpLocaleService(async () => {
      abort.abort()
      return sample
    })
    await expect(service.detect(undefined, abort.signal)).rejects.toThrow('CANCELLED')
    await expect(
      createIpLocaleService(async () => {
        throw new Error('secret path')
      }).detect(),
    ).rejects.toThrow('IP_LOCALE_FAILED')
  })
})
