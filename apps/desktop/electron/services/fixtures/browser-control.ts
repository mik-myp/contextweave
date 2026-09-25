import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import type { ControlMessage } from '../browser-control-pipe'

/** Test-only in-memory browser implementing a minimal flattened CDP session tree. */
export function controlFixture() {
  const child = new ChildProcess()
  const input = new PassThrough(),
    output = new PassThrough()
  Object.defineProperty(child, 'stdio', { value: [null, null, null, input, output] })
  const commands: ControlMessage[] = []
  let sequence = 0
  let handler: ((message: ControlMessage) => boolean) | undefined
  const emit = (message: ControlMessage) =>
    output.write(Buffer.from(`${JSON.stringify(message)}\0`))
  input.on('data', (chunk: Buffer) => {
    for (const text of chunk.toString('utf8').split('\0').filter(Boolean)) {
      const message: ControlMessage = JSON.parse(text)
      commands.push(message)
      if (handler?.(message)) continue
      const id = message.id
      if (message.method === 'Target.attachToBrowserTarget')
        emit({ id, result: { sessionId: `root-${++sequence}` } })
      else if (message.method === 'Target.attachToTarget') {
        const sessionId = `page-${++sequence}`
        emit({
          method: 'Target.attachedToTarget',
          sessionId: message.sessionId,
          params: { sessionId, targetInfo: { type: 'page' } },
        })
        emit({ id, result: { sessionId } })
      } else if (message.method === 'Target.detachFromTarget') {
        emit({ id, result: {} })
      } else if (message.method === 'Browser.getVersion')
        emit({ id, result: { product: 'Chrome/123.0.0.1' } })
      else emit({ id, result: {} })
    }
  })
  return {
    child,
    input,
    output,
    commands,
    emit,
    handle: (value: typeof handler) => {
      handler = value
    },
  }
}
