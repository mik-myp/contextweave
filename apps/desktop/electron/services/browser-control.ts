import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { browserControlPath, type BrowserControlLease } from './browser-control-access'
import { createControlPipe, controlLimits, type ControlPipe } from './browser-control-pipe'
import { createControlSessions } from './browser-control-sessions'

type Ticket = {
  digest: Buffer
  timer: ReturnType<typeof setTimeout>
  socket?: WebSocket
  revoked: boolean
  expiresAt: number
}
const digest = (token: string) => createHash('sha256').update(token).digest()

/** Allocate before launch, attach only the child's inherited descriptors, then issue leases. */
export async function createBrowserControl() {
  let pipe: ControlPipe | undefined
  let routing: ReturnType<typeof createControlSessions> | undefined
  let closed = false
  const tickets = new Set<Ticket>()
  const sockets = new Set<Socket>()
  const active = new Map<WebSocket, () => void>()
  const server = createServer((_, response) => {
    response.writeHead(404, { Connection: 'close', 'Content-Length': '0' })
    response.end()
  })
  const ws = new WebSocketServer({
    noServer: true,
    maxPayload: controlLimits.commandBytes,
    perMessageDeflate: false,
    clientTracking: false,
  })
  server.maxHeadersCount = 32
  server.maxConnections = 32
  server.headersTimeout = 2000
  server.requestTimeout = 2000
  server.timeout = 2000
  server.keepAliveTimeout = 1000
  server.on('connection', (socket) => {
    sockets.add(socket)
    // Bound clients that never send an HTTP header. Upgrade clears this timeout.
    socket.setTimeout(2000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
  })
  function expire(ticket: Ticket) {
    tickets.delete(ticket)
    clearTimeout(ticket.timer)
  }
  function revoke(ticket: Ticket) {
    if (ticket.revoked) return
    ticket.revoked = true
    expire(ticket)
    if (ticket.socket) {
      active.get(ticket.socket)?.()
      ticket.socket.terminate()
    }
  }
  function close() {
    if (closed) return
    closed = true
    for (const ticket of tickets) revoke(ticket)
    routing?.close()
    pipe?.close()
    for (const [socket, release] of active) {
      release()
      socket.terminate()
    }
    active.clear()
    for (const socket of sockets) socket.destroy()
    ws.close()
    server.close()
  }
  server.on('error', close)
  await new Promise<void>((resolve, reject) => {
    const failed = () => reject(new Error('CONTROL_UNAVAILABLE'))
    server.once('error', failed)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', failed)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string' || closed) {
    close()
    throw new Error('CONTROL_UNAVAILABLE')
  }
  const port = address.port

  function authenticate(request: IncomingMessage): Ticket | undefined {
    if (closed || !routing || !pipe || pipe.closed || active.size >= controlLimits.clients) return
    const names = request.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .map((name) => name.toLowerCase())
    if (
      request.method !== 'GET' ||
      request.url !== browserControlPath ||
      request.headers.host !== `127.0.0.1:${port}` ||
      names.includes('origin') ||
      names.filter((name) => name === 'host').length !== 1 ||
      names.filter((name) => name === 'authorization').length !== 1 ||
      request.socket.remoteAddress !== '127.0.0.1'
    )
      return
    const header = request.headers.authorization
    if (!header || !/^Bearer [a-f0-9]{64}$/.test(header)) return
    const received = digest(header.slice(7))
    let found: Ticket | undefined
    for (const ticket of tickets) if (timingSafeEqual(ticket.digest, received)) found = ticket
    if (!found || found.revoked || found.expiresAt <= performance.now()) return
    // Synchronous consumption prevents simultaneous upgrades replaying the same ticket.
    expire(found)
    return found
  }
  server.on('upgrade', (request, socket, head) => {
    const ticket = authenticate(request)
    if (!ticket || !routing) {
      socket.destroy()
      return
    }
    request.socket.setTimeout(0)
    ws.handleUpgrade(request, socket, head, (client) => {
      ticket.socket = client
      client.on('error', () => client.terminate())
      client.pause()
      const connection = routing!.connect(
        (message) => {
          if (client.readyState !== WebSocket.OPEN) return
          const text = JSON.stringify(message)
          if (client.bufferedAmount + Buffer.byteLength(text) > controlLimits.frameBytes) {
            connection.close()
            return
          }
          client.send(text, (error) => {
            if (error) connection.close()
          })
        },
        () => client.terminate(),
      )
      active.set(client, connection.close)
      client.on('message', (data, binary) => {
        if (binary || !(data instanceof Buffer)) {
          connection.close()
          return
        }
        // ws validates text UTF-8 and caps message bytes, including fragmented messages.
        void connection.receive(data.toString('utf8'))
      })
      client.once('close', () => {
        connection.close()
        active.delete(client)
        ticket.socket = undefined
        ticket.revoked = true
      })
      void connection.ready.then(() => {
        if (!ticket.revoked && client.readyState === WebSocket.OPEN) client.resume()
      })
    })
  })

  return {
    port,
    close,
    attach(child: ChildProcess) {
      if (pipe || closed) throw new Error('CONTROL_UNAVAILABLE')
      const input = child.stdio?.[3],
        output = child.stdio?.[4]
      if (!(input instanceof Writable) || !(output instanceof Readable))
        throw new Error('CONTROL_PIPE_UNAVAILABLE')
      pipe = createControlPipe(input, output)
      routing = createControlSessions(pipe)
      pipe.onClose(close)
      child.once('exit', close)
      child.once('error', close)
    },
    lease(): BrowserControlLease {
      for (const ticket of tickets) if (ticket.expiresAt <= performance.now()) revoke(ticket)
      if (
        closed ||
        !pipe ||
        pipe.closed ||
        tickets.size >= controlLimits.tickets ||
        active.size >= controlLimits.clients
      )
        throw new Error('CONTROL_UNAVAILABLE')
      const token = randomBytes(32).toString('hex')
      const ticket: Ticket = {
        digest: digest(token),
        revoked: false,
        expiresAt: performance.now() + controlLimits.ticketLifetimeMs,
        timer: setTimeout(() => revoke(ticket), controlLimits.ticketLifetimeMs),
      }
      tickets.add(ticket)
      return { access: { port, token }, revoke: () => revoke(ticket) }
    },
    async ready(signal: AbortSignal): Promise<string> {
      if (!pipe || closed) throw new Error('CONTROL_UNAVAILABLE')
      const response = await pipe.send('Browser.getVersion', {}, undefined, {
        timeoutMs: 30000,
        signal,
      })
      if (response.error) throw new Error('CONTROL_UNAVAILABLE')
      return z.object({ product: z.string().min(1).max(256) }).parse(response.result).product
    },
    async closeBrowser() {
      if (pipe && !pipe.closed) await pipe.send('Browser.close', {}, undefined, { timeoutMs: 1000 })
    },
  }
}
export type BrowserControl = Awaited<ReturnType<typeof createBrowserControl>>
