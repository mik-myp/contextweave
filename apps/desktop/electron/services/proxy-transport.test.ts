import { createServer as httpServer, get, type RequestListener } from 'node:http'
import { createServer as tcpServer, createConnection } from 'node:net'
import { once } from 'node:events'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { openProxyTransport, testProxyTransport } from './proxy-transport'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(rejectAuth = false, handler?: RequestListener) {
  const target = httpServer(
    handler ?? ((_request, response) => response.end('through-authenticated-proxy')),
  )
  target.listen(0, '127.0.0.1')
  await once(target, 'listening')
  const targetAddress = target.address()
  if (!targetAddress || typeof targetAddress === 'string') throw new Error('fixture address')
  const requests: { username: string; password: string; hostname: string }[] = []
  const sockets = new Set<Duplex>()
  const proxy = tcpServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    let stage = 0,
      buffer = Buffer.alloc(0)
    let username = '',
      password = ''
    const handle = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 0 && buffer.length >= 2 + buffer[1]) {
        buffer = buffer.subarray(2 + buffer[1])
        stage = 1
        socket.write(Buffer.from([5, 2]))
      }
      if (stage === 1 && buffer.length >= 2 + buffer[1] + 1) {
        const offset = 2 + buffer[1],
          length = buffer[offset]
        if (buffer.length < offset + 1 + length) return
        username = buffer.toString('utf8', 2, offset)
        password = buffer.toString('utf8', offset + 1, offset + 1 + length)
        buffer = buffer.subarray(offset + 1 + length)
        stage = 2
        socket.write(Buffer.from([1, rejectAuth ? 1 : 0]))
        if (rejectAuth) {
          socket.end()
          return
        }
      }
      if (stage === 2 && buffer.length >= 5 && buffer[3] === 3 && buffer.length >= 7 + buffer[4]) {
        const hostname = buffer.toString('utf8', 5, 5 + buffer[4])
        requests.push({ username, password, hostname })
        stage = 3
        socket.removeListener('data', handle)
        const upstream = createConnection({ host: '127.0.0.1', port: targetAddress.port })
        sockets.add(upstream)
        upstream.on('close', () => sockets.delete(upstream))
        upstream.on('error', () => socket.destroy())
        upstream.once('connect', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]))
          socket.pipe(upstream).pipe(socket)
        })
        socket.on('close', () => upstream.destroy())
      }
    }
    socket.on('data', handle)
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const address = proxy.address()
  if (!address || typeof address === 'string') throw new Error('fixture address')
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
    await new Promise<void>((resolve) => target.close(() => resolve()))
  })
  return { port: address.port, requests }
}
function request(port: number, authorization?: string) {
  return new Promise<{ status?: number; body: string }>((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: 'http://remote-dns.invalid/fixture',
        headers: {
          Host: 'remote-dns.invalid',
          ...(authorization ? { 'Proxy-Authorization': authorization } : {}),
        },
        signal: AbortSignal.timeout(3000),
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => (body += chunk))
        response.once('end', () => resolve({ status: response.statusCode, body }))
        response.once('error', reject)
      },
    )
    req.once('error', reject)
  })
}
describe('private authenticated proxy transport', () => {
  it('authenticates to SOCKS5, resolves the destination remotely, blocks unauthenticated local clients and closes sockets', async () => {
    const upstream = await fixture()
    const transport = await openProxyTransport(
      { type: 'socks5', host: '127.0.0.1', port: upstream.port, username: 'fixture-user' },
      'fixture-secret',
    )
    cleanups.push(transport.close)
    const auth = transport.authentication
    expect((await request(auth.port)).status).toBe(407)
    const result = await request(
      auth.port,
      `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
    )
    expect(result).toEqual({ status: 200, body: 'through-authenticated-proxy' })
    expect(upstream.requests).toEqual([
      { username: 'fixture-user', password: 'fixture-secret', hostname: 'remote-dns.invalid' },
    ])
    expect(transport.args.join(' ')).not.toMatch(/fixture-user|fixture-secret/)
    await transport.close()
    await expect(request(auth.port)).rejects.toThrow()
  })
  it('returns a proxy failure instead of connecting directly when upstream authentication fails', async () => {
    const upstream = await fixture(true)
    const transport = await openProxyTransport(
      { type: 'socks5', host: '127.0.0.1', port: upstream.port, username: 'fixture-user' },
      'incorrect',
    )
    cleanups.push(transport.close)
    const auth = transport.authentication
    const result = await request(
      auth.port,
      `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
    )
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.body).not.toContain('incorrect')
    expect(upstream.requests).toEqual([])
  })
})

it('separates connectivity from an unavailable IP endpoint and retains remote DNS with no warning flag', async () => {
  const upstream = await fixture(false, (request, response) => {
    response.statusCode = request.url === '/ip' ? 503 : 204
    response.end()
  })
  const config = {
    type: 'socks5' as const,
    host: '127.0.0.1',
    port: upstream.port,
    username: 'fixture-user',
  }
  const result = await testProxyTransport(config, 'fixture-secret', AbortSignal.timeout(3000), [
    { url: 'http://remote-dns.invalid/ip', kind: 'ip', timeoutMs: 1000 },
    { url: 'http://remote-dns.invalid/connected', kind: 'connectivity', timeoutMs: 1000 },
  ])
  expect(result).toMatchObject({ success: true, connectivity: 'http', exitIpUnavailable: true })
  expect(result.exitIp).toBeUndefined()
  expect(upstream.requests).toHaveLength(2)
  const transport = await openProxyTransport(config, 'fixture-secret')
  cleanups.push(transport.close)
  expect(transport.args).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /host-resolver-rules|disable-web-security|test-type|ignore-certificate/,
      ),
    ]),
  )
  expect(transport.args).toContain('--dns-prefetch-disable')
})
it('times out stalled bodies and rejects oversized IP responses without leaking credentials', async () => {
  const upstream = await fixture(false, (request, response) => {
    if (request.url === '/large') response.end('x'.repeat(5000))
    else {
      response.writeHead(200)
      response.write('{')
    }
  })
  const result = await testProxyTransport(
    { type: 'socks5', host: '127.0.0.1', port: upstream.port, username: 'fixture-user' },
    'fixture-secret',
    AbortSignal.timeout(250),
    [
      { url: 'http://remote-dns.invalid/large', kind: 'ip', timeoutMs: 100 },
      { url: 'http://remote-dns.invalid/stall', kind: 'ip', timeoutMs: 1000 },
    ],
  )
  expect(result).toMatchObject({ success: false, errorCode: 'PROXY_TEST_TIMEOUT' })
  expect(JSON.stringify(result)).not.toMatch(/fixture-user|fixture-secret/)
})
it('tests an authenticated HTTP CONNECT proxy without a direct-network fallback', async () => {
  const requests: string[] = []
  const sockets = new Set<Duplex>()
  const proxy = httpServer()
  proxy.on('connect', (request, socket) => {
    requests.push(request.headers['proxy-authorization'] ?? '')
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    if (
      request.headers['proxy-authorization'] !==
      `Basic ${Buffer.from('user:secret').toString('base64')}`
    ) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    socket.once('data', () => socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n'))
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const address = proxy.address()
  if (!address || typeof address === 'string') throw new Error('fixture address')
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
  })
  const probes = [
    {
      url: 'http://no-local-dns.invalid/connected',
      kind: 'connectivity' as const,
      timeoutMs: 1000,
    },
  ]
  const config = { type: 'http' as const, host: '127.0.0.1', port: address.port, username: 'user' }
  expect(
    await testProxyTransport(config, 'secret', AbortSignal.timeout(3000), probes),
  ).toMatchObject({ success: true })
  expect(
    await testProxyTransport(config, 'wrong', AbortSignal.timeout(3000), probes),
  ).toMatchObject({ success: false })
  expect(requests).toHaveLength(2)
})
