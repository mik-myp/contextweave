import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { get as getHttps } from 'node:https'
import { get as getHttp, type IncomingMessage } from 'node:http'
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
      '--dns-prefetch-disable',
      '--disable-background-networking',
      '--disable-quic',
    ],
    close: () => (closed ??= server.close(true)),
  }
}
export type ProxyTransport = Awaited<ReturnType<typeof openProxyTransport>>
type ProxyProbe = { url: string; kind: 'ip' | 'connectivity'; timeoutMs: number }
const proxyProbes: readonly ProxyProbe[] = [
  { url: 'https://api.ipify.org?format=json', kind: 'ip', timeoutMs: 5000 },
  { url: 'https://www.gstatic.com/generate_204', kind: 'connectivity', timeoutMs: 5000 },
  { url: 'http://www.gstatic.com/generate_204', kind: 'connectivity', timeoutMs: 4000 },
]

async function probeProxy(
  target: ProxyProbe,
  agent: HttpsProxyAgent<string>,
  proxy: ProxyTransport['authentication'],
  signal: AbortSignal,
) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(target.timeoutMs)])
  const body = await new Promise<string>((resolve, reject) => {
    const receive = (response: IncomingMessage): void => {
      let body = '',
        bytes = 0
      if (response.statusCode !== (target.kind === 'ip' ? 200 : 204)) {
        request.destroy(new Error('PROXY_TEST_FAILED'))
        return
      }
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 4096) {
          request.destroy(new Error('PROXY_TEST_FAILED'))
          return
        }
        body += chunk
      })
      response.on('error', reject)
      response.once('aborted', () => reject(new Error('PROXY_TEST_FAILED')))
      response.once('end', () => resolve(body))
    }
    const headers = { Accept: target.kind === 'ip' ? 'application/json' : '*/*' }
    const request = target.url.startsWith('https:')
      ? getHttps(target.url, { agent, signal: requestSignal, headers }, receive)
      : getHttp(
          {
            // HTTP-only proxies may reject CONNECT, including CONNECT to port 80.
            // Send ordinary absolute-form HTTP exclusively to the private bridge.
            hostname: proxy.host,
            port: proxy.port,
            path: target.url,
            agent: false, // Do not pool sockets for short-lived, authenticated local bridges.
            signal: requestSignal,
            headers: {
              ...headers,
              Host: new URL(target.url).host,
              'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
            },
          },
          receive,
        )
    request.on('error', reject)
  })
  if (target.kind === 'connectivity') return undefined
  const parsed: unknown = JSON.parse(body)
  const ip =
    typeof parsed === 'object' && parsed !== null && 'ip' in parsed && typeof parsed.ip === 'string'
      ? parsed.ip
      : undefined
  if (!ip || !isIP(ip)) throw new Error('PROXY_TEST_FAILED')
  return ip
}

export async function testProxyTransport(
  config: ProxyConfig,
  password: string,
  signal = AbortSignal.timeout(15000),
  probes: readonly ProxyProbe[] = proxyProbes,
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
    for (const probe of probes) {
      signal.throwIfAborted()
      const probeStarted = Date.now()
      try {
        const exitIp = await probeProxy(probe, agent, auth, signal)
        return {
          success: true,
          exitIp,
          exitIpUnavailable: !exitIp,
          connectivity: probe.url.startsWith('https:') ? 'https' : 'http',
          latencyMs: Date.now() - probeStarted,
          checkedAt: new Date().toISOString(),
        }
      } catch {
        // A blocked IP provider is not proof that the proxy cannot carry traffic.
        // Every fallback still goes through the authenticated bridge, with TLS verification on.
      }
    }
    throw new Error('PROXY_TEST_FAILED')
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
