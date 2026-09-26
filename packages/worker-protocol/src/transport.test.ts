import { describe, expect, it } from 'vitest'
import {
  maxWorkerScreenshotBytes, maxWorkerScreenshotChunkBytes,
  workerChildMessageSchema, workerParentMessageSchema,
} from './index'

describe('private utility transport schemas', () => {
  const request = {
    task: { protocolVersion: 1, taskId: 'task', environmentId: 'environment', kind: 'browser-smoke', input: { url: 'http://127.0.0.1/', timeoutMs: 1000 } },
    control: { port: 12345, token: 'a'.repeat(64) },
  }
  it('accepts the bounded handshake and acknowledgment protocol', () => {
    for (const message of [
      { type: 'request', request }, { type: 'chunk-ack', sequence: 0 }, { type: 'result-ack' },
    ]) expect(workerParentMessageSchema.safeParse({ version: 1, ...message }).success).toBe(true)
    for (const message of [
      { type: 'ready' }, { type: 'screenshot-start', bytes: 8 },
      { type: 'screenshot-chunk', sequence: 0, data: new Uint8Array(8) },
      { type: 'screenshot-end', bytes: 8, chunks: 1 },
      { type: 'result', result: { protocolVersion: 1, taskId: 'task', environmentId: 'environment', ok: true } },
    ]) expect(workerChildMessageSchema.safeParse({ version: 1, ...message }).success).toBe(true)
  })
  it('rejects over-limit, shared, sliced, empty and non-byte-array payloads', () => {
    for (const data of [
      new Uint8Array(maxWorkerScreenshotChunkBytes + 1),
      new Uint8Array(maxWorkerScreenshotBytes).subarray(0, 8),
      new Uint8Array(new SharedArrayBuffer(8)),
      new Uint8Array(), [1, 2, 3], 'bytes', new Int8Array(8),
    ]) expect(workerChildMessageSchema.safeParse({ version: 1, type: 'screenshot-chunk', sequence: 0, data }).success).toBe(false)
  })
  it('rejects invalid total sizes and sequence limits', () => {
    for (const bytes of [0, 7, -1, 10.5, maxWorkerScreenshotBytes + 1])
      expect(workerChildMessageSchema.safeParse({ version: 1, type: 'screenshot-start', bytes }).success).toBe(false)
    for (const sequence of [-1, 0.5, 512, '0'])
      expect(workerParentMessageSchema.safeParse({ version: 1, type: 'chunk-ack', sequence }).success).toBe(false)
  })
  it('refuses undocumented messages, paths, secrets and unsupported versions', () => {
    expect(workerChildMessageSchema.safeParse({ version: 2, type: 'ready' }).success).toBe(false)
    expect(workerChildMessageSchema.safeParse({ version: 1, type: 'ready', diagnostic: 'secret' }).success).toBe(false)
    expect(workerParentMessageSchema.safeParse({ version: 1, type: 'request', request: { ...request, screenshotPath: '/outside' } }).success).toBe(false)
    expect(workerParentMessageSchema.safeParse({ version: 1, type: 'command', shell: 'anything' }).success).toBe(false)
    const result = { protocolVersion: 1, taskId: 'task', environmentId: 'environment', ok: false, errorCode: 'WORKER_ERROR', errorMessage: 'Worker execution failed' }
    expect(workerChildMessageSchema.safeParse({ version: 1, type: 'result', result }).success).toBe(true)
    expect(workerChildMessageSchema.safeParse({ version: 1, type: 'result', result: { ...result, errorMessage: 'Authorization: secret' } }).success).toBe(false)
  })
})
