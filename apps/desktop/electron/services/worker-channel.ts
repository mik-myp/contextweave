import {
  maxWorkerScreenshotBytes,
  maxWorkerScreenshotChunkBytes,
  workerParentMessageSchema,
  workerProcessResultSchema,
  workerTransportVersion,
  type WorkerChildMessage,
  type WorkerParentMessage,
  type WorkerProcessRequest,
} from '@contextweave/worker-protocol'

interface PrivateParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  postMessage(message: WorkerChildMessage): void
}

/** One child, one request, one in-flight chunk. No filesystem or Electron imports. */
export function createWorkerChannel(port: PrivateParentPort) {
  let failed = false
  let pending:
    | {
        accepts(message: WorkerParentMessage): boolean
        resolve(message: WorkerParentMessage): void
        reject(error: Error): void
      }
    | undefined
  const fail = () => {
    failed = true
    const waiting = pending
    pending = undefined
    waiting?.reject(new Error('WORKER_PROTOCOL_FAILED'))
  }
  port.on('message', ({ data }) => {
    const parsed = workerParentMessageSchema.safeParse(data)
    if (!parsed.success || !pending || !pending.accepts(parsed.data)) {
      fail()
      return
    }
    const waiting = pending
    pending = undefined
    waiting.resolve(parsed.data)
  })
  const exchange = (
    message: WorkerChildMessage,
    accepts: (reply: WorkerParentMessage) => boolean,
  ) =>
    new Promise<WorkerParentMessage>((resolve, reject) => {
      if (failed || pending) {
        reject(new Error('WORKER_PROTOCOL_FAILED'))
        return
      }
      pending = { accepts, resolve, reject }
      try {
        port.postMessage(message)
      } catch {
        fail()
      }
    })
  let requested = false
  let screenshotSent = false
  let resultSent = false
  return {
    async request(): Promise<WorkerProcessRequest> {
      if (requested) throw new Error('WORKER_PROTOCOL_FAILED')
      requested = true
      const message = await exchange(
        { version: workerTransportVersion, type: 'ready' },
        (reply) => reply.type === 'request',
      )
      if (message.type !== 'request') throw new Error('WORKER_PROTOCOL_FAILED')
      return message.request
    },
    async screenshot(data: Uint8Array) {
      if (
        !requested ||
        screenshotSent ||
        resultSent ||
        failed ||
        pending ||
        data.byteLength < 8 ||
        data.byteLength > maxWorkerScreenshotBytes
      )
        throw new Error('WORKER_OUTPUT_LIMIT')
      screenshotSent = true
      port.postMessage({
        version: workerTransportVersion,
        type: 'screenshot-start',
        bytes: data.byteLength,
      })
      let sequence = 0
      for (let start = 0; start < data.byteLength; start += maxWorkerScreenshotChunkBytes) {
        // Buffer.subarray/slice would keep the entire screenshot's backing buffer.
        // Structured cloning must copy only this exact bounded chunk, not 32 MiB each time.
        const chunk = new Uint8Array(
          Math.min(maxWorkerScreenshotChunkBytes, data.byteLength - start),
        )
        chunk.set(data.subarray(start, start + chunk.byteLength))
        const current = sequence++
        await exchange(
          {
            version: workerTransportVersion,
            type: 'screenshot-chunk',
            sequence: current,
            data: chunk,
          },
          (reply) => reply.type === 'chunk-ack' && reply.sequence === current,
        )
      }
      port.postMessage({
        version: workerTransportVersion,
        type: 'screenshot-end',
        bytes: data.byteLength,
        chunks: sequence,
      })
    },
    async result(input: unknown) {
      const result = workerProcessResultSchema.parse(input)
      if (!requested || resultSent || (result.ok && !screenshotSent))
        throw new Error('WORKER_PROTOCOL_FAILED')
      resultSent = true
      await exchange(
        { version: workerTransportVersion, type: 'result', result },
        (reply) => reply.type === 'result-ack',
      )
    },
  }
}
