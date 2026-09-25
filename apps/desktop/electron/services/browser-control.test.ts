import { once } from 'node:events'
import { WebSocket, type ClientOptions } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserControl } from './browser-control'
import { browserControlUrl, type BrowserControlAccess } from './browser-control-access'
import { controlFixture } from './fixtures/browser-control'
import type { ControlMessage } from './browser-control-pipe'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0).reverse()) clean()
  vi.restoreAllMocks()
})
async function fixture() {
  const browser = controlFixture()
  const control = await createBrowserControl()
  cleanups.push(control.close)
  control.attach(browser.child)
  return { browser, control }
}
async function connect(access: BrowserControlAccess, options: ClientOptions = {}) {
  const socket = new WebSocket(browserControlUrl(access), {
    headers: { Authorization: `Bearer ${access.token}` },
    ...options,
  })
  socket.on('error', () => {})
  cleanups.push(() => socket.terminate())
  await once(socket, 'open')
  return socket
}
async function denied(url: string, headers: Record<string, string | undefined> = {}) {
  const socket = new WebSocket(url, { headers, handshakeTimeout: 2000 })
  return new Promise<void>((resolve, reject) => {
    socket.on('error', () => resolve())
    socket.on('open', () => {
      socket.terminate()
      reject(new Error('Unauthorized connection admitted'))
    })
    socket.on('unexpected-response', (_, response) => {
      response.resume()
      socket.terminate()
      resolve()
    })
  })
}
function command(socket: WebSocket, id = 1): Promise<ControlMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Fixture response timeout'))
    }, 2000)
    const message = (data: Buffer) => {
      const parsed: ControlMessage = JSON.parse(data.toString('utf8'))
      if (parsed.id === id) {
        cleanup()
        resolve(parsed)
      }
    }
    const close = () => {
      cleanup()
      reject(new Error('Fixture disconnected'))
    }
    function cleanup() {
      clearTimeout(timer)
      socket.off('message', message)
      socket.off('close', close)
    }
    socket.on('message', message)
    socket.once('close', close)
    socket.send(JSON.stringify({ id, method: 'Browser.getVersion' }))
  })
}

describe('Main-owned authenticated browser control broker', () => {
  it('has no discovery API and rejects absent, wrong and replayed credentials', async () => {
    const { control } = await fixture()
    const lease = control.lease(),
      url = browserControlUrl(lease.access)
    await denied(url)
    await denied(url, { Authorization: `Bearer ${'0'.repeat(64)}` })
    const response = await fetch(`http://127.0.0.1:${control.port}/json/version`)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    const socket = await connect(lease.access)
    expect((await command(socket)).result?.product).toBe('Chrome/123.0.0.1')
    await denied(url, { Authorization: `Bearer ${lease.access.token}` })
    expect((await command(socket, 2)).result?.product).toBe('Chrome/123.0.0.1')
  })
  it.each([
    { headers: { Origin: 'https://attacker.invalid' } },
    { headers: { Origin: '' } },
    { headers: { Host: 'attacker.invalid' } },
    { suffix: '?token=not-accepted' },
    { suffix: '/' },
  ])(
    'rejects unsafe upgrade metadata without consuming a valid credential',
    async ({ headers, suffix }) => {
      const { control } = await fixture()
      const lease = control.lease()
      await denied(browserControlUrl(lease.access) + (suffix ?? ''), {
        Authorization: `Bearer ${lease.access.token}`,
        ...headers,
      })
      const socket = await connect(lease.access)
      expect((await command(socket)).result?.product).toBe('Chrome/123.0.0.1')
    },
  )
  it('rejects credentials for a different environment broker', async () => {
    const a = await fixture(),
      b = await fixture()
    const lease = a.control.lease(),
      other = b.control.lease()
    await denied(browserControlUrl(other.access), { Authorization: `Bearer ${lease.access.token}` })
    const socket = await connect(lease.access)
    expect((await command(socket)).error).toBeUndefined()
  })
  it('checks monotonic expiry even when timer dispatch is delayed', async () => {
    const { control } = await fixture()
    const lease = control.lease()
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 16000)
    await denied(browserControlUrl(lease.access), { Authorization: `Bearer ${lease.access.token}` })
    const fresh = control.lease(),
      socket = await connect(fresh.access)
    expect((await command(socket)).error).toBeUndefined()
  })
  it('revokes unused and connected tickets without stopping a peer', async () => {
    const { control, browser } = await fixture()
    const unused = control.lease()
    unused.revoke()
    unused.revoke()
    await denied(browserControlUrl(unused.access), {
      Authorization: `Bearer ${unused.access.token}`,
    })
    const a = control.lease(),
      b = control.lease()
    const first = await connect(a.access),
      second = await connect(b.access)
    await command(first)
    await command(second)
    const closed = once(first, 'close')
    a.revoke()
    await closed
    expect((await command(second, 2)).error).toBeUndefined()
    expect(
      browser.commands
        .filter((c) => c.method === 'Target.detachFromTarget')
        .map((c) => c.params?.sessionId),
    ).toEqual(['root-1'])
    expect(browser.commands.some((c) => c.method === 'Browser.close')).toBe(false)
  })
  it('caps pending leases and active connections without opening an unauthenticated fallback', async () => {
    const { control } = await fixture()
    const tickets = Array.from({ length: 16 }, () => control.lease())
    expect(() => control.lease()).toThrow('CONTROL_UNAVAILABLE')
    tickets[15].revoke()
    const replacement = control.lease()
    const clients = []
    for (const ticket of tickets.slice(0, 8)) {
      const client = await connect(ticket.access)
      await command(client)
      clients.push(client)
    }
    await denied(browserControlUrl(replacement.access), {
      Authorization: `Bearer ${replacement.access.token}`,
    })
    const closed = once(clients[0], 'close')
    tickets[0].revoke()
    await closed
    const next = await connect(replacement.access)
    expect((await command(next)).error).toBeUndefined()
  })
  it.each(['binary', 'oversize', 'foreign-session', 'malformed'])(
    'closes a bad client (%s) while keeping a healthy peer',
    async (mode) => {
      const { control, browser } = await fixture()
      const a = await connect(control.lease().access),
        b = await connect(control.lease().access)
      await command(a)
      await command(b)
      const closed = once(a, 'close')
      if (mode === 'binary') a.send(Buffer.from('untrusted'))
      else if (mode === 'oversize') a.send('x'.repeat(1024 * 1024 + 1))
      else if (mode === 'malformed') a.send('{oops')
      else a.send(JSON.stringify({ id: 5, method: 'Runtime.evaluate', sessionId: 'root-2' }))
      await closed
      expect((await command(b, 2)).error).toBeUndefined()
      expect(browser.commands.some((c) => c.method === 'Runtime.evaluate')).toBe(false)
    },
  )
  it('closes streams and all sockets on browser exit; dead leases cannot be reissued', async () => {
    const { control, browser } = await fixture()
    const socket = await connect(control.lease().access)
    await command(socket)
    const closed = once(socket, 'close')
    browser.child.emit('exit', 0, null)
    await closed
    expect(browser.input.destroyed).toBe(true)
    expect(browser.output.destroyed).toBe(true)
    expect(() => control.lease()).toThrow('CONTROL_UNAVAILABLE')
    control.close()
  })
  it('rejects missing pipe descriptors and does not issue tickets before attach', async () => {
    const control = await createBrowserControl()
    cleanups.push(control.close)
    const browser = controlFixture()
    browser.child.stdio[3] = null
    expect(() => control.lease()).toThrow('CONTROL_UNAVAILABLE')
    expect(() => control.attach(browser.child)).toThrow('CONTROL_PIPE_UNAVAILABLE')
  })
})

it.each(['Host', 'Authorization'])(
  'rejects duplicate %s headers even with a valid ticket',
  async (name) => {
    const { createConnection } = await import('node:net')
    const { control } = await fixture(),
      lease = control.lease()
    const host = `127.0.0.1:${control.port}`,
      auth = `Bearer ${lease.access.token}`
    const socket = createConnection({ host: '127.0.0.1', port: control.port })
    const chunks: Buffer[] = []
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.on('error', () => {})
    const closed = once(socket, 'close')
    socket.write(
      `GET /contextweave/browser HTTP/1.1\r\nHost: ${host}\r\nAuthorization: ${auth}\r\n${name}: ${name === 'Host' ? host : auth}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    )
    await closed
    expect(Buffer.concat(chunks).toString('utf8')).not.toContain('101 Switching Protocols')
    const valid = await connect(lease.access)
    expect((await command(valid)).error).toBeUndefined()
  },
)
