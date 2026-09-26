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
  retired: Set<string>
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
    client.retired.delete(id)
    sessions.set(id, { client, parent })
  }

  function removeTree(id: string) {
    const removed = new Set([id])
    // Iterative traversal avoids stack growth for deeply nested iframe sessions.
    for (const parent of removed)
      for (const [child, owner] of sessions) if (owner.parent === parent) removed.add(child)
    for (const child of removed) {
      const client = sessions.get(child)?.client
      if (client && !client.closed) {
        client.retired.add(child)
        // Recent ownership is enough to reject buffered commands without treating a
        // normal detach as a peer-session attack. Never retain an unbounded history.
        if (client.retired.size > sessionLimit) {
          const oldest = client.retired.values().next().value
          if (oldest !== undefined) client.retired.delete(oldest)
        }
      }
      sessions.delete(child)
    }
  }

  function closeClient(client: Client) {
    if (client.closed) return
    client.closed = true
    client.pending.clear()
    client.retired.clear()
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
        retired: new Set(),
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
            if (client.pending.has(request.id) || client.pending.size >= 128)
              throw new Error('CONTROL_SESSION_OWNERSHIP')
            const ownedSession = (id: string) => {
              const owner = sessions.get(id)
              if (owner?.client === client) return owner
              if (!owner && client.retired.has(id)) return undefined
              throw new Error('CONTROL_SESSION_OWNERSHIP')
            }
            const owner = ownedSession(sessionId)
            const params = request.params ?? {}
            if (
              [
                'Target.sendMessageToTarget',
                'Target.exposeDevToolsProtocol',
                'Target.autoAttachRelated',
              ].includes(request.method)
            )
              throw new Error('CONTROL_LEGACY_SESSION')
            const detachedId =
              request.method === 'Target.detachFromTarget'
                ? detachSchema.parse(params).sessionId
                : undefined
            if (detachedId === client.root) throw new Error('CONTROL_SESSION_OWNERSHIP')
            const detachedOwner = detachedId ? ownedSession(detachedId) : undefined
            if (
              ['Target.attachToTarget', 'Target.setAutoAttach'].includes(request.method) &&
              params.flatten !== true
            )
              throw new Error('CONTROL_LEGACY_SESSION')
            const rejectDetached = (addressedSession: boolean) =>
              client.send({
                id: request.id,
                sessionId: request.sessionId,
                error: addressedSession
                  ? { code: -32001, message: 'Session with given id not found.' }
                  : { code: -32602, message: 'No session with given id' },
              })
            if (!owner || (detachedId && !detachedOwner)) {
              rejectDetached(!owner)
              return
            }
            client.pending.add(request.id)
            admittedId = request.id
            client.bytes += bytes
            if (client.active < 24) {
              client.active++
              acquired = true
            } else acquired = await new Promise<boolean>((resolve) => client.waiters.push(resolve))
            if (!acquired || client.closed) return
            // Admission captured the exact ownership object. A detach (even followed by
            // history eviction or ID reuse) invalidates this command, not healthy peers.
            if (
              sessions.get(sessionId) !== owner ||
              (detachedId && sessions.get(detachedId) !== detachedOwner)
            ) {
              rejectDetached(sessions.get(sessionId) !== owner)
              return
            }
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
              // Chromium emits attachedToTarget before its attachToTarget response.
              // That event owns child registration: a detach may already have removed
              // it before this promise resumes. Never resurrect it from a late reply.
              // Browser roots are attached at the pipe root, whose events are private.
              if (browserRoot) register(attached, client)
            }
            if (!response.error && detachedId && sessions.get(detachedId) === detachedOwner)
              removeTree(detachedId)
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
