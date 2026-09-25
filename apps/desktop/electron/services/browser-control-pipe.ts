import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'

export const controlLimits = {
  frameBytes: 64 * 1024 * 1024,
  commandBytes: 1024 * 1024,
  queuedBytes: 4 * 1024 * 1024,
  pendingCommands: 256,
  commandTimeoutMs: 130000,
  sessions: 1024,
  clients: 8,
  tickets: 16,
  ticketLifetimeMs: 15000,
} as const

const recordSchema = z.record(z.string(), z.unknown())
const wireMessageSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  sessionId: z.string().min(1).max(256).optional(),
  method: z.string().min(1).max(256).optional(),
  params: recordSchema.optional(),
  result: recordSchema.optional(),
  error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
})
export type ControlMessage = z.infer<typeof wireMessageSchema>
export type ControlResponse = Pick<ControlMessage, 'result' | 'error'>
export type ControlPipe = ReturnType<typeof createControlPipe>

type Pending = {
  resolve(response: ControlResponse): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  cleanup(): void
}

/** An owned Chromium pipe. No debug port, discovery request or credentials on disk. */
export function createControlPipe(
  input: Writable,
  output: Readable,
  limits: typeof controlLimits | { [K in keyof typeof controlLimits]: number } = controlLimits,
) {
  const pending = new Map<number, Pending>()
  const events = new Set<(message: ControlMessage) => void>()
  const closures = new Set<() => void>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let sequence = 0
  let closed = false
  let frame = Buffer.alloc(Math.min(65536, limits.frameBytes))
  let length = 0

  function close(code = 'CONTROL_CLOSED') {
    if (closed) return
    closed = true
    output.removeListener('data', receive)
    input.destroy()
    output.destroy()
    frame = Buffer.alloc(0)
    length = 0
    for (const command of pending.values()) {
      clearTimeout(command.timer)
      command.cleanup()
      command.reject(new Error(code))
    }
    pending.clear()
    for (const listener of closures) listener()
    events.clear()
    closures.clear()
  }

  function append(part: Buffer) {
    const needed = length + part.length
    if (needed > limits.frameBytes) throw new Error('CONTROL_FRAME_LIMIT')
    if (needed > frame.length) {
      const next = Buffer.allocUnsafe(
        Math.min(limits.frameBytes, Math.max(needed, frame.length * 2)),
      )
      frame.copy(next, 0, 0, length)
      frame = next
    }
    part.copy(frame, length)
    length = needed
  }

  function receive(chunk: Buffer) {
    if (closed) return
    try {
      let offset = 0
      while (offset < chunk.length && !closed) {
        const boundary = chunk.indexOf(0, offset)
        const end = boundary === -1 ? chunk.length : boundary
        append(chunk.subarray(offset, end))
        offset = end + 1
        if (boundary === -1) break
        const message = wireMessageSchema.parse(
          JSON.parse(decoder.decode(frame.subarray(0, length))),
        )
        length = 0
        if (message.id !== undefined) {
          if (message.method || (!message.result && !message.error))
            throw new Error('CONTROL_PROTOCOL')
          const command = pending.get(message.id)
          if (!command) continue // A cancelled request may have already completed in Chromium.
          pending.delete(message.id)
          clearTimeout(command.timer)
          command.cleanup()
          command.resolve({ result: message.result, error: message.error })
        } else {
          if (!message.method || message.result || message.error)
            throw new Error('CONTROL_PROTOCOL')
          for (const listener of events) listener(message)
        }
      }
    } catch {
      close('CONTROL_PROTOCOL')
    }
  }

  input.on('error', () => close())
  output.on('error', () => close())
  input.once('close', () => close())
  output.once('close', () => close())
  output.once('end', () => close())
  output.on('data', receive)

  return {
    close,
    get closed() {
      return closed
    },
    onEvent(listener: (message: ControlMessage) => void) {
      events.add(listener)
      return () => {
        events.delete(listener)
      }
    },
    onClose(listener: () => void) {
      if (closed) listener()
      else closures.add(listener)
      return () => {
        closures.delete(listener)
      }
    },
    send(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
      options: { timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<ControlResponse> {
      return new Promise((resolve, reject) => {
        if (closed) return reject(new Error('CONTROL_CLOSED'))
        if (options.signal?.aborted) return reject(new Error('CONTROL_CANCELLED'))
        if (pending.size >= limits.pendingCommands || sequence >= Number.MAX_SAFE_INTEGER)
          return reject(new Error('CONTROL_COMMAND_LIMIT'))
        const id = ++sequence
        let packet: Buffer
        try {
          packet = Buffer.from(`${JSON.stringify({ id, method, params, sessionId })}\0`)
        } catch {
          return reject(new Error('CONTROL_PROTOCOL'))
        }
        if (
          packet.length > limits.commandBytes ||
          input.writableLength + packet.length > limits.queuedBytes
        )
          return reject(new Error('CONTROL_COMMAND_LIMIT'))
        const cancel = () => {
          const command = pending.get(id)
          if (!command) return
          pending.delete(id)
          clearTimeout(command.timer)
          command.cleanup()
          reject(new Error('CONTROL_CANCELLED'))
        }
        const timer = setTimeout(
          () => {
            // Fail closed: a timed-out attach may otherwise leave an unowned session.
            close('CONTROL_TIMEOUT')
          },
          Math.min(options.timeoutMs ?? limits.commandTimeoutMs, limits.commandTimeoutMs),
        )
        pending.set(id, {
          resolve,
          reject,
          timer,
          cleanup: () => options.signal?.removeEventListener('abort', cancel),
        })
        options.signal?.addEventListener('abort', cancel, { once: true })
        input.write(packet, (error) => {
          if (error) close()
        })
      })
    },
  }
}
