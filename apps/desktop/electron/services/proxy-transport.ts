import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { get } from 'node:https'
import { Server } from 'proxy-chain'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ProxyConfig, ProxyTestResult } from '@contextweave/contracts'

function secretMatches(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
export async function openProxyTransport(config: ProxyConfig, password = '') {
  // Only this closure holds the upstream credential; never return or log the URL.
  const upstream = new URL(
    `${config.type === 'socks5' ? 'socks5h' : config.type}://${config.host}:${config.port}`,
  )
  if (config.username) {
    upstream.username = config.username
    upstream.password = password
  }
  const username = randomBytes(16).toString('hex')
  const token = randomBytes(32).toString('hex')
  const server = new Server({
    host: '127.0.0.1',
    port: 0,
    verbose: false,
    prepareRequestFunction: (request) => ({
      requestAuthentication:
        !secretMatches(request.username, username) || !secretMatches(request.password, token),
      upstreamProxyUrl: upstream.href,
      failMsg: 'Proxy authentication required',
    }),
  })
  // proxy-chain errors may embed upstream URLs. They must never enter application logs.
  server.on('requestFailed', () => {})
  await server.listen()
  let closed: Promise<void> | undefined
  return {
    authentication: { host: '127.0.0.1', port: server.port, username, password: token },
    args: [
      `--proxy-server=http://127.0.0.1:${server.port}`,
      '--proxy-bypass-list=<-loopback>',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--disable-quic',
    ],
    close: () => (closed ??= server.close(true)),
  }
}
export type ProxyTransport = Awaited<ReturnType<typeof openProxyTransport>>
export async function testProxyTransport(
  config: ProxyConfig,
  password: string,
  signal = AbortSignal.timeout(15000),
): Promise<ProxyTestResult> {
  const started = Date.now()
  let transport: ProxyTransport | undefined
  let agent: HttpsProxyAgent<string> | undefined
  try {
    signal.throwIfAborted()
    transport = await openProxyTransport(config, password)
    const auth = transport.authentication
    const url = new URL(`http://${auth.host}:${auth.port}`)
    url.username = auth.username
    url.password = auth.password
    agent = new HttpsProxyAgent(url)
    const body = await new Promise<string>((resolve, reject) => {
      const request = get(
        'https://api.ipify.org?format=json',
        { agent, signal, headers: { Accept: 'application/json' } },
        (response) => {
          let body = ''
          if (response.statusCode !== 200) {
            response.resume()
            reject(new Error('PROXY_TEST_FAILED'))
            return
          }
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            body += chunk
            if (body.length > 4096) request.destroy(new Error('PROXY_TEST_FAILED'))
          })
          response.once('error', reject)
          response.once('end', () => resolve(body))
        },
      )
      request.once('error', reject)
    })
    const parsed: unknown = JSON.parse(body)
    const ip =
      typeof parsed === 'object' &&
      parsed !== null &&
      'ip' in parsed &&
      typeof parsed.ip === 'string'
        ? parsed.ip
        : undefined
    if (!ip || !isIP(ip)) throw new Error('PROXY_TEST_FAILED')
    return {
      success: true,
      exitIp: ip,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }
  } catch {
    return {
      success: false,
      errorCode: signal.aborted ? 'PROXY_TEST_TIMEOUT' : 'PROXY_TEST_FAILED',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }
  } finally {
    agent?.destroy()
    await transport?.close()
  }
}
