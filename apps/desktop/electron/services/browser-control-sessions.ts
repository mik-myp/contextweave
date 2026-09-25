import { z } from 'zod'
import { controlLimits, type ControlMessage, type ControlPipe } from './browser-control-pipe'

const requestSchema = z
  .object({
    id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    method: z
      .string()
      .max(256)
      .regex(/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/),
    params: z.record(z.string(), z.unknown()).optional(),
    sessionId: z.string().min(1).max(256).optional(),
  })
  .strict()
const sessionSchema = z.object({ sessionId: z.string().min(1).max(256) })
const detachSchema = sessionSchema.strict()
type Client = {
  root?: string
  closed: boolean
  pending: Set<number>
  rootRequests: number
  active: number
  bytes: number
  waiters: ((granted: boolean) => void)[]
  controller: AbortController
  send(message: ControlMessage): void
  terminate(): void
}
type OwnedSession = { client: Client; parent?: string }

/** Isolates protocol sessions, not pages: an authorized client controls its entire environment. */
export function createControlSessions(
  pipe: ControlPipe,
  sessionLimit: number = controlLimits.sessions,
) {
  const sessions = new Map<string, OwnedSession>()
  const clients = new Set<Client>()
  let closed = false

  function register(id: string, client: Client, parent?: string) {
    const previous = sessions.get(id)
    if (previous) {
      if (previous.client !== client) {
        pipe.close()
        throw new Error('CONTROL_SESSION_OWNERSHIP')
      }
      return
    }
    if (sessions.size >= sessionLimit) {
      pipe.close()
      throw new Error('CONTROL_SESSION_LIMIT')
    }
    sessions.set(id, { client, parent })
  }

  function removeTree(id: string) {
    const removed = new Set([id])
    // Iterative traversal avoids stack growth for deeply nested iframe sessions.
    for (const parent of removed)
      for (const [child, owner] of sessions) if (owner.parent === parent) removed.add(child)
    for (const child of removed) sessions.delete(child)
  }

  function closeClient(client: Client) {
    if (client.closed) return
    client.closed = true
    client.pending.clear()
    client.controller.abort()
    for (const waiting of client.waiters.splice(0)) waiting(false)
    clients.delete(client)
    client.terminate()
    // Detach each browser-level root (including explicit newBrowserCDPSession roots).
    const roots = [...sessions].filter(([, owner]) => owner.client === client && !owner.parent)
    for (const [id, owner] of sessions) if (owner.client === client) sessions.delete(id)
    for (const [sessionId] of roots)
      void pipe
        .send('Target.detachFromTarget', { sessionId }, undefined, { timeoutMs: 5000 })
        .then((response) => {
          if (response.error && !pipe.closed) pipe.close()
        })
        .catch(() => {
          if (!pipe.closed) pipe.close()
        })
  }

  const removeEvents = pipe.onEvent((message) => {
    if (!message.sessionId) {
      // Root detach events live on the pipe itself, unlike page-session events.
      if (message.method === 'Target.detachedFromTarget') {
        const parsed = sessionSchema.safeParse(message.params)
        if (!parsed.success) {
          pipe.close()
          return
        }
        const owner = sessions.get(parsed.data.sessionId)
        if (owner) {
          removeTree(parsed.data.sessionId)
          if (owner.client.root === parsed.data.sessionId) closeClient(owner.client)
          else owner.client.send(message)
        }
      }
      return // Top-level transport discovery is never broadcast.
    }
    const owner = sessions.get(message.sessionId)
    if (!owner || owner.client.closed) return
    const client = owner.client
    try {
      if (message.method === 'Target.attachedToTarget') {
        const { sessionId } = sessionSchema.parse(message.params)
        register(sessionId, client, message.sessionId)
      } else if (message.method === 'Target.detachedFromTarget') {
        const { sessionId } = sessionSchema.parse(message.params)
        if (sessions.get(sessionId)?.client !== client) return
        removeTree(sessionId)
      } else if (message.method === 'Target.receivedMessageFromTarget') {
        throw new Error('CONTROL_LEGACY_SESSION')
      }
      client.send({
        ...message,
        sessionId: message.sessionId === client.root ? undefined : message.sessionId,
      })
    } catch {
      closeClient(client)
    }
  })
  const removeClose = pipe.onClose(() => {
    for (const client of clients) closeClient(client)
    sessions.clear()
  })

  return {
    connect(send: Client['send'], terminate: Client['terminate']) {
      if (closed || pipe.closed) throw new Error('CONTROL_CLOSED')
      const client: Client = {
        closed: false,
        pending: new Set(),
        rootRequests: 0,
        active: 0,
        bytes: 0,
        waiters: [],
        controller: new AbortController(),
        send,
        terminate,
      }
      clients.add(client)
      const ready = pipe
        .send('Target.attachToBrowserTarget', {}, undefined, { timeoutMs: 10000 })
        .then((response) => {
          if (response.error) throw new Error('CONTROL_SESSION_FAILED')
          const { sessionId } = sessionSchema.parse(response.result)
          // Revocation may race the browser's attach response; never leak the late root.
          if (client.closed) {
            void pipe
              .send('Target.detachFromTarget', { sessionId }, undefined, { timeoutMs: 5000 })
              .then((result) => {
                if (result.error) pipe.close()
              })
              .catch(() => pipe.close())
            return
          }
          register(sessionId, client)
          client.root = sessionId
        })
        .catch(() => {
          closeClient(client)
          pipe.close()
        })
      return {
        ready,
        close: () => closeClient(client),
        async receive(text: string) {
          if (client.closed || !client.root) return closeClient(client)
          let admittedId: number | undefined
          let acquired = false
          let rootRequest = false
          const bytes = Buffer.byteLength(text)
          try {
            if (
              bytes > controlLimits.commandBytes ||
              client.bytes + bytes > controlLimits.queuedBytes
            )
              throw new Error('CONTROL_COMMAND_LIMIT')
            const request = requestSchema.parse(JSON.parse(text))
            const sessionId = request.sessionId ?? client.root
            if (
              sessions.get(sessionId)?.client !== client ||
              client.pending.has(request.id) ||
              client.pending.size >= 128
            )
              throw new Error('CONTROL_SESSION_OWNERSHIP')
            const params = request.params ?? {}
            if (
              [
                'Target.sendMessageToTarget',
                'Target.exposeDevToolsProtocol',
                'Target.autoAttachRelated',
              ].includes(request.method)
            )
              throw new Error('CONTROL_LEGACY_SESSION')
            if (request.method === 'Target.detachFromTarget') {
              const target = detachSchema.parse(params).sessionId
              if (target === client.root || sessions.get(target)?.client !== client)
                throw new Error('CONTROL_SESSION_OWNERSHIP')
            }
            if (
              ['Target.attachToTarget', 'Target.setAutoAttach'].includes(request.method) &&
              params.flatten !== true
            )
              throw new Error('CONTROL_LEGACY_SESSION')
            client.pending.add(request.id)
            admittedId = request.id
            client.bytes += bytes
            if (client.active < 24) {
              client.active++
              acquired = true
            } else acquired = await new Promise<boolean>((resolve) => client.waiters.push(resolve))
            if (!acquired || client.closed) return
            // A queued command must not outlive a detach/revoke observed while waiting.
            if (
              sessions.get(sessionId)?.client !== client ||
              (request.method === 'Target.detachFromTarget' &&
                sessions.get(detachSchema.parse(params).sessionId)?.client !== client)
            )
              throw new Error('CONTROL_SESSION_OWNERSHIP')
            // Browser-root attachment is issued at the transport root, never borrowed from another client.
            const browserRoot = request.method === 'Target.attachToBrowserTarget'
            if (browserRoot) {
              const roots = [...sessions.values()].filter(
                (owner) => owner.client === client && !owner.parent,
              ).length
              if (roots + client.rootRequests >= 8) throw new Error('CONTROL_SESSION_LIMIT')
              client.rootRequests++
              rootRequest = true
            }
            const response = await pipe.send(
              request.method,
              params,
              browserRoot ? undefined : sessionId,
              browserRoot ? { timeoutMs: 5000 } : { signal: client.controller.signal },
            )
            if (
              !response.error &&
              ['Target.attachToTarget', 'Target.attachToBrowserTarget'].includes(request.method)
            ) {
              const attached = sessionSchema.parse(response.result).sessionId
              if (client.closed) {
                if (browserRoot)
                  void pipe
                    .send('Target.detachFromTarget', { sessionId: attached }, undefined, {
                      timeoutMs: 5000,
                    })
                    .then((result) => {
                      if (result.error) pipe.close()
                    })
                    .catch(() => pipe.close())
                return
              }
              register(attached, client, browserRoot ? undefined : sessionId)
            }
            if (!response.error && request.method === 'Target.detachFromTarget')
              removeTree(sessionSchema.parse(params).sessionId)
            if (!client.closed)
              client.send({ id: request.id, ...response, sessionId: request.sessionId })
          } catch {
            closeClient(client)
          } finally {
            if (rootRequest) client.rootRequests--
            if (admittedId !== undefined) {
              client.pending.delete(admittedId)
              client.bytes -= bytes
            }
            if (acquired) {
              const next = client.waiters.shift()
              if (next && !client.closed)
                next(true) // Transfer the slot before the waiter resumes.
              else client.active--
            }
          }
        },
      }
    },
    close() {
      closed = true
      removeEvents()
      removeClose()
      for (const client of clients) closeClient(client)
      sessions.clear()
    },
  }
}
