import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  installRuntimeDiagnostics,
  readRuntimeFailureEvidence,
  restoreRuntimeDiagnostics,
} from './smoke-runtime-diagnostics.mjs'

const appPath = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const { WebSocket } = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('ws')
const desktop = { evaluate: (fn) => Promise.resolve(fn({ app: { getAppPath: () => appPath } })) }

test('failure diagnostics are bounded, redact payloads and restore the original transport methods', async () => {
  const originalEmit = WebSocket.prototype.emit
  const originalSend = WebSocket.prototype.send
  await installRuntimeDiagnostics(desktop)
  try {
    // Event-only fixture: it opens no socket and has no credentials or live CDP lease.
    const socket = new EventEmitter()
    Object.setPrototypeOf(socket, WebSocket.prototype)
    Object.defineProperty(socket, 'url', { value: 'ws://127.0.0.1:12345/contextweave/browser' })
    const secret = 'SENSITIVE_CANARY_MUST_NOT_BE_RECORDED'
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          method: 'Target.targetCreated',
          params: {
            targetInfo: { type: 'page', url: `https://${secret}`, title: secret },
            Authorization: secret,
            sessionId: secret,
          },
        }),
      ),
    )
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ id: 1, error: { code: -32000, message: secret } })),
    )
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ id: 2, result: { screenshot: secret.repeat(65536) } })),
    )
    const first = await readRuntimeFailureEvidence(desktop)
    assert.equal(first.controlEvents.length, 2)
    assert.equal(first.controlEvents[0].method, 'Target.targetCreated')
    assert.equal(first.controlEvents[0].targetType, 'page')
    assert.equal(first.controlEvents[1].errorKind, 'REDACTED_PROTOCOL_ERROR')
    assert.equal(JSON.stringify(first).includes(secret), false)
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ method: secret, params: { token: secret } })),
    )
    assert.equal(JSON.stringify(await readRuntimeFailureEvidence(desktop)).includes(secret), false)
    for (let index = 0; index < 300; index++)
      socket.emit('message', Buffer.from('{"method":"Target.targetDestroyed"}'))
    assert.equal((await readRuntimeFailureEvidence(desktop)).controlEvents.length, 200)
  } finally {
    await restoreRuntimeDiagnostics(desktop)
  }
  assert.equal(WebSocket.prototype.emit, originalEmit)
  assert.equal(WebSocket.prototype.send, originalSend)
  assert.deepEqual(await readRuntimeFailureEvidence(desktop), { processes: [], controlEvents: [] })
})
