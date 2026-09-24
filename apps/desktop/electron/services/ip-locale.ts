import { get } from 'node:https'
import { isIP } from 'node:net'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { z } from 'zod'
import {
  ipLocaleResultSchema,
  type IpLocaleResult,
  type CommonEnvironmentConfig,
} from '@contextweave/contracts'
import type { ProxyTransport } from './proxy-transport'

type ProxyAuthentication = ProxyTransport['authentication']
const endpoint = 'https://ipwho.is/?fields=success,ip,country_code,timezone.id'
const providerResult = z.object({
  success: z.literal(true),
  ip: z
    .string()
    .max(45)
    .refine((value) => Boolean(isIP(value))),
  country_code: z.string().regex(/^[A-Z]{2}$/),
  timezone: z.object({ id: z.string().max(100) }),
})

export function parseIpLocale(body: string, connection: 'direct' | 'proxy'): IpLocaleResult {
  try {
    const data = providerResult.parse(JSON.parse(body))
    const locale = new Intl.Locale(`und-${data.country_code}`).maximize()
    const region = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' }).of(
      data.country_code,
    )
    if (!region || locale.language === 'und' || data.country_code === 'ZZ') throw new Error()
    return ipLocaleResultSchema.parse({
      ip: data.ip,
      countryCode: data.country_code,
      timezone: data.timezone.id,
      language: `${locale.language}-${data.country_code}`,
      connection,
      provider: 'ipwho.is',
      checkedAt: new Date().toISOString(),
    })
  } catch {
    // Never expose provider bodies (or network exceptions containing credentials).
    throw new Error('IP_LOCALE_INVALID_RESPONSE')
  }
}

export async function requestIpLocale(
  proxy: ProxyAuthentication | undefined,
  signal: AbortSignal,
): Promise<IpLocaleResult> {
  let agent: HttpsProxyAgent<string> | undefined
  if (proxy) {
    const url = new URL(`http://${proxy.host}:${proxy.port}`)
    url.username = proxy.username
    url.password = proxy.password
    agent = new HttpsProxyAgent(url)
  }
  try {
    signal.throwIfAborted()
    const body = await new Promise<string>((resolve, reject) => {
      const request = get(
        endpoint,
        { agent: agent ?? false, signal, headers: { Accept: 'application/json' } },
        (response) => {
          response.on('error', () => reject(new Error('IP_LOCALE_FAILED')))
          response.once('aborted', () => reject(new Error('IP_LOCALE_FAILED')))
          if (response.statusCode !== 200) {
            // No redirect or HTTP fallback, even when the provider is unavailable.
            reject(
              new Error(
                response.statusCode === 429 ? 'IP_LOCALE_RATE_LIMITED' : 'IP_LOCALE_FAILED',
              ),
            )
            response.destroy()
            return
          }
          let body = ''
          let bytes = 0
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk)
            if (bytes > 8192) {
              reject(new Error('IP_LOCALE_INVALID_RESPONSE'))
              response.destroy()
              request.destroy()
              return
            }
            body += chunk
          })
          response.once('end', () => resolve(body))
        },
      )
      request.on('error', () => reject(new Error('IP_LOCALE_FAILED')))
    })
    signal.throwIfAborted()
    return parseIpLocale(body, proxy ? 'proxy' : 'direct')
  } finally {
    agent?.destroy()
  }
}

export function applyIpLocale(config: CommonEnvironmentConfig, locale: IpLocaleResult) {
  return {
    ...config,
    language: config.language === 'auto' ? locale.language : config.language,
    timezone: config.timezone === 'auto' ? locale.timezone : config.timezone,
  }
}

export function createIpLocaleService(request = requestIpLocale) {
  const closing = new AbortController()
  const active = new Set<Promise<IpLocaleResult>>()
  return {
    detect(proxy?: ProxyAuthentication, parentSignal?: AbortSignal): Promise<IpLocaleResult> {
      if (closing.signal.aborted) return Promise.reject(new Error('APP_CLOSING'))
      if (active.size >= 3) return Promise.reject(new Error('IP_LOCALE_BUSY'))
      const timeout = AbortSignal.timeout(10000)
      const signal = AbortSignal.any([
        closing.signal,
        timeout,
        ...(parentSignal ? [parentSignal] : []),
      ])
      const operation = (async () => {
        try {
          signal.throwIfAborted()
          const result = await request(proxy, signal)
          signal.throwIfAborted()
          return ipLocaleResultSchema.parse(result)
        } catch (error) {
          if (parentSignal?.aborted || closing.signal.aborted) throw new Error('CANCELLED')
          if (timeout.aborted) throw new Error('IP_LOCALE_TIMEOUT')
          const code = error instanceof Error ? error.message : ''
          throw new Error(
            ['IP_LOCALE_RATE_LIMITED', 'IP_LOCALE_INVALID_RESPONSE'].includes(code)
              ? code
              : 'IP_LOCALE_FAILED',
          )
        }
      })().finally(() => active.delete(operation))
      active.add(operation)
      return operation
    },
    async shutdown() {
      closing.abort()
      await Promise.allSettled([...active])
    },
  }
}
export type IpLocaleService = ReturnType<typeof createIpLocaleService>
