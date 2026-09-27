import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  installRuntimeDiagnostics,
  readRuntimeFailureEvidence,
  restoreRuntimeDiagnostics,
  summarizeFixtureCookie,
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

const fixtureCookie = {
  name: 'cw-cookie',
  value: 'retained',
  domain: '127.0.0.1',
  path: '/',
  expires: 300,
}

test('cookie evidence distinguishes an empty result from a persistent fixture', () => {
  assert.deepEqual(summarizeFixtureCookie([], 100), {
    present: false,
    expectedValue: false,
    persistent: false,
    expectedScope: false,
    expectedPersistentCookie: false,
  })
  assert.deepEqual(summarizeFixtureCookie([fixtureCookie], 100), {
    present: true,
    expectedValue: true,
    persistent: true,
    expectedScope: true,
    expectedPersistentCookie: true,
  })
})

test('cookie evidence does not confuse session, expired or invalid expiry with persistence', () => {
  for (const expires of [-1, 99, 100, NaN, Infinity, '300', undefined]) {
    const evidence = summarizeFixtureCookie([{ ...fixtureCookie, expires }], 100)
    assert.equal(evidence.present, true)
    assert.equal(evidence.persistent, false)
    assert.equal(evidence.expectedPersistentCookie, false)
  }
})

test('cookie evidence requires the expected value, host and path in the same cookie', () => {
  for (const difference of [
    { value: 'different' },
    { domain: 'other.invalid' },
    { path: '/other' },
  ]) {
    const evidence = summarizeFixtureCookie([{ ...fixtureCookie, ...difference }], 100)
    assert.equal(evidence.present, true)
    assert.equal(evidence.expectedPersistentCookie, false)
  }
  const evidence = summarizeFixtureCookie(
    [
      { ...fixtureCookie, value: 'different' },
      { ...fixtureCookie, expires: -1 },
    ],
    100,
  )
  assert.equal(evidence.expectedValue, true)
  assert.equal(evidence.persistent, true)
  assert.equal(evidence.expectedPersistentCookie, false)
})

test('cookie evidence ignores unrelated cookies and never exposes payload fields', () => {
  const secret = 'COOKIE_DIAGNOSTIC_SECRET_CANARY'
  const evidence = summarizeFixtureCookie(
    [
      {
        ...fixtureCookie,
        name: secret,
        value: secret,
        domain: secret,
        path: secret,
      },
      { ...fixtureCookie, value: secret, domain: secret, path: secret, secret },
    ],
    100,
  )
  assert.equal(evidence.present, true)
  assert.equal(evidence.expectedPersistentCookie, false)
  assert.equal(Object.keys(evidence).length, 5)
  assert(Object.values(evidence).every((value) => typeof value === 'boolean'))
  assert.equal(JSON.stringify(evidence).includes(secret), false)
  assert.equal(
    JSON.stringify(summarizeFixtureCookie([{ ...fixtureCookie, name: secret }], 100)).includes(
      'true',
    ),
    false,
  )
})
