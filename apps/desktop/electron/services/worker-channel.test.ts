import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  maxWorkerScreenshotBytes,
  maxWorkerScreenshotChunkBytes,
  type WorkerChildMessage,
  type WorkerParentMessage,
} from '@contextweave/worker-protocol'
import { createWorkerChannel } from './worker-channel'

const request = {
  task: {
    protocolVersion: 1 as const,
    taskId: 'task',
    environmentId: 'environment',
    kind: 'browser-smoke' as const,
    input: { url: 'http://127.0.0.1/', timeoutMs: 1000 },
  },
  control: { port: 12345, token: 'a'.repeat(64) },
}
function fixture() {
  const port = new EventEmitter()
  const messages: WorkerChildMessage[] = []
  const channel = createWorkerChannel(
    Object.assign(port, {
      postMessage: (message: WorkerChildMessage) => {
        messages.push(structuredClone(message))
      },
    }),
  )
  const receive = (message: WorkerParentMessage) =>
    port.emit('message', { data: structuredClone(message) })
  const begin = async () => {
    const pending = channel.request()
    expect(messages[0]).toEqual({ version: 1, type: 'ready' })
    receive({ version: 1, type: 'request', request })
    expect(await pending).toEqual(request)
  }
  return { channel, messages, receive, begin, port }
}

describe('private child channel', () => {
  it('waits for each ACK and clones only exact independent chunk buffers', async () => {
    const { channel, messages, receive, begin } = fixture()
    await begin()
    const screenshot = Buffer.alloc(maxWorkerScreenshotChunkBytes * 2 + 11, 31)
    const writing = channel.screenshot(screenshot)
    expect(messages.map((message) => message.type)).toEqual([
      'ready',
      'screenshot-start',
      'screenshot-chunk',
    ])
    for (let sequence = 0; sequence < 3; sequence++) {
      await vi.waitFor(() =>
        expect(messages.filter((message) => message.type === 'screenshot-chunk')).toHaveLength(
          sequence + 1,
        ),
      )
      const chunk = messages.at(-1)
      expect(chunk?.type).toBe('screenshot-chunk')
      if (chunk?.type !== 'screenshot-chunk') throw new Error('Missing chunk')
      const length = sequence < 2 ? maxWorkerScreenshotChunkBytes : 11
      expect(chunk.data).toHaveLength(length)
      expect(chunk.data.buffer.byteLength).toBe(length)
      expect(chunk.data.byteOffset).toBe(0)
      expect(chunk.data).toEqual(new Uint8Array(length).fill(31))
      receive({ version: 1, type: 'chunk-ack', sequence })
    }
    await writing
    expect(messages.at(-1)).toEqual({
      version: 1,
      type: 'screenshot-end',
      bytes: screenshot.length,
      chunks: 3,
    })
    let completed = false
    const result = channel
      .result({ protocolVersion: 1, taskId: 'task', environmentId: 'environment', ok: true })
      .then(() => {
        completed = true
      })
    await Promise.resolve()
    expect(completed).toBe(false)
    receive({ version: 1, type: 'result-ack' })
    await result
    expect(completed).toBe(true)
  })
  it('rejects unexpected ACK sequence and cannot recover into success', async () => {
    const { channel, receive, begin } = fixture()
    await begin()
    const writing = channel.screenshot(new Uint8Array(11))
    const rejected = expect(writing).rejects.toThrow('WORKER_PROTOCOL_FAILED')
    receive({ version: 1, type: 'chunk-ack', sequence: 1 })
    await rejected
    await expect(
      channel.result({
        protocolVersion: 1,
        taskId: 'task',
        environmentId: 'environment',
        ok: true,
      }),
    ).rejects.toThrow()
  })
  it('rejects replayed requests and invalid protocol versions', async () => {
    const { channel, port, begin } = fixture()
    await begin()
    port.emit('message', { data: { version: 2, type: 'request', request } })
    await expect(channel.screenshot(new Uint8Array(11))).rejects.toThrow()
    await expect(channel.request()).rejects.toThrow()
  })
  it('rejects invalid screenshot bounds before sending chunks', async () => {
    const { channel, messages, begin } = fixture()
    await begin()
    await expect(channel.screenshot(new Uint8Array(7))).rejects.toThrow('WORKER_OUTPUT_LIMIT')
    await expect(channel.screenshot(new Uint8Array(maxWorkerScreenshotBytes + 1))).rejects.toThrow(
      'WORKER_OUTPUT_LIMIT',
    )
    expect(messages.map((message) => message.type)).toEqual(['ready'])
  })
  it('does not serialize arbitrary error strings', async () => {
    const { channel, messages, begin } = fixture()
    await begin()
    await expect(
      channel.result({
        protocolVersion: 1,
        taskId: 'task',
        environmentId: 'environment',
        ok: false,
        errorCode: 'WORKER_ERROR',
        errorMessage: 'private token',
      }),
    ).rejects.toThrow()
    expect(messages.map((message) => message.type)).toEqual(['ready'])
  })
})
