import {
  maxWorkerProtocolBytes,
  maxWorkerScreenshotChunkBytes,
  workerChildMessageSchema,
  workerTransportVersion,
  type WorkerParentMessage,
  type WorkerProcessRequest,
  type WorkerProcessResult,
} from '@contextweave/worker-protocol'
import type { createWorkerOutput } from './worker-output'

/** Main-side state machine. The child cannot choose paths or queue unbounded writes. */
export function createWorkerTransfer(
  request: WorkerProcessRequest,
  output: ReturnType<typeof createWorkerOutput>,
  send: (message: WorkerParentMessage) => void,
  onFailure: (code: string) => void,
) {
  let phase: 'ready' | 'active' | 'ended' | 'result' = 'ready'
  let stopped = false
  let declaredBytes: number | undefined
  let writtenBytes = 0
  let sequence = 0
  let writing = false
  let metadataBytes = 0
  let result: WorkerProcessResult | undefined
  const fail = (code = 'WORKER_FAILED') => {
    if (stopped) return
    stopped = true
    onFailure(code)
  }
  const reply = (message: WorkerParentMessage) => {
    if (!stopped) {
      try {
        send(message)
      } catch {
        fail()
      }
    }
  }
  return {
    stop() {
      stopped = true
    },
    get result() {
      return result
    },
    receive(input: unknown) {
      if (stopped) return
      const parsed = workerChildMessageSchema.safeParse(input)
      if (!parsed.success) {
        fail()
        return
      }
      const message = parsed.data
      metadataBytes += Buffer.byteLength(
        JSON.stringify(
          message.type === 'screenshot-chunk' ? { ...message, data: undefined } : message,
        ),
      )
      if (metadataBytes > maxWorkerProtocolBytes) {
        fail('WORKER_OUTPUT_LIMIT')
        return
      }
      if (writing || phase === 'result') {
        fail()
        return
      }
      if (phase === 'ready') {
        if (message.type !== 'ready') {
          fail()
          return
        }
        phase = 'active'
        reply({ version: workerTransportVersion, type: 'request', request })
        return
      }
      switch (message.type) {
        case 'ready':
          fail()
          break
        case 'screenshot-start':
          if (phase !== 'active' || declaredBytes !== undefined) {
            fail()
            return
          }
          declaredBytes = message.bytes
          break
        case 'screenshot-chunk': {
          if (
            phase !== 'active' ||
            declaredBytes === undefined ||
            message.sequence !== sequence ||
            message.data.byteLength !==
              Math.min(maxWorkerScreenshotChunkBytes, declaredBytes - writtenBytes)
          ) {
            fail()
            return
          }
          writing = true
          void output
            .append(message.data)
            .then(() => {
              writing = false
              writtenBytes += message.data.byteLength
              sequence++
              reply({
                version: workerTransportVersion,
                type: 'chunk-ack',
                sequence: message.sequence,
              })
            })
            .catch(() => {
              writing = false
              fail('WORKER_OUTPUT_FAILED')
            })
          break
        }
        case 'screenshot-end':
          if (
            phase !== 'active' ||
            declaredBytes !== writtenBytes ||
            message.bytes !== writtenBytes ||
            message.chunks !== sequence
          ) {
            fail()
            return
          }
          phase = 'ended'
          break
        case 'result':
          if (
            message.result.taskId !== request.task.taskId ||
            message.result.environmentId !== request.task.environmentId ||
            (message.result.ok && phase !== 'ended')
          ) {
            fail()
            return
          }
          phase = 'result'
          result = message.result
          reply({ version: workerTransportVersion, type: 'result-ack' })
      }
    },
  }
}
