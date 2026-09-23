import { createServer as httpServer, get } from 'node:http'
import { createServer as tcpServer, createConnection, type Socket } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { openProxyTransport } from './proxy-transport'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(rejectAuth = false) {
  const target = httpServer((_request, response) => response.end('through-authenticated-proxy'))
  target.listen(0, '127.0.0.1')
  await once(target, 'listening')
  const targetAddress = target.address()
  if (!targetAddress || typeof targetAddress === 'string') throw new Error('fixture address')
  const requests: { username: string; password: string; hostname: string }[] = []
  const sockets = new Set<Socket>()
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
