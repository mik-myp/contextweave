import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cleanElectronEnvironment,
  hasCommittedAppTarget,
  probeCommittedAppTarget,
  requestNativeQuit,
  spawnOwned,
  stopOwned,
  until,
  withDeadline,
} from './native-packaged-host.mjs'

test('test host clears inherited Electron/Node injection controls before explicit test overrides', () => {
  const names = [
    'NODE_OPTIONS',
    'NODE_PATH',
    'NODE_EXTRA_CA_CERTS',
    'ELECTRON_RUN_AS_NODE',
    'CONTEXTWEAVE_USER_DATA',
    'ELECTRON_RENDERER_URL',
    'VITE_DEV_SERVER_URL',
  ]
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    for (const name of names) process.env[name] = 'fixture-never-inherit'
    const cleaned = cleanElectronEnvironment()
    for (const name of names) assert.equal(cleaned[name], undefined)
    assert.equal(
      cleanElectronEnvironment({ NODE_OPTIONS: 'explicit-negative-fixture' }).NODE_OPTIONS,
      'explicit-negative-fixture',
    )
  } finally {
    for (const name of names)
      if (original[name] === undefined) delete process.env[name]
      else process.env[name] = original[name]
  }
})
test('deadlines preserve primary errors and bound an unanswered typed request', async () => {
  const error = new Error('PRIMARY_FIXTURE_ERROR')
  await assert.rejects(
    withDeadline(Promise.reject(error), 1000, 'DEADLINE'),
    (actual) => actual === error,
  )
  await assert.rejects(
    withDeadline(new Promise(() => {}), 10, 'BOUNDED_REQUEST'),
    /BOUNDED_REQUEST/,
  )
  assert.equal(await withDeadline(Promise.resolve(7), 1000, 'DEADLINE'), 7)
})
test('owned process cleanup waits for the actual child exit and is idempotent', async () => {
  const state = spawnOwned(process.execPath, [
    '-e',
    "console.log('READY');setInterval(()=>{},1000)",
  ])
  try {
    await until(() => state.stdout.includes('READY'), 3000, 'FIXTURE_NOT_READY')
    await stopOwned(state)
    assert(state.exit)
    await stopOwned(state)
  } finally {
    await stopOwned(state)
  }
})

test('quit tolerates a reply destroyed by orderly shutdown only after confirmed clean OS exit', async () => {
  for (const code of [0, 1]) {
    const state = { exit: undefined }
    const page = {
      isClosed: () => true,
      async evaluate() {
        state.exit = { code, signal: null }
        throw new Error('Target page, context or browser has been closed')
      },
    }
    if (code === 0) await requestNativeQuit(page, state)
    else await assert.rejects(requestNativeQuit(page, state), /NATIVE_QUIT_NOT_CLEAN/)
  }
})
test('quit never masks an IPC denial, unrelated failure or an application that had already exited', async () => {
  await assert.rejects(
    requestNativeQuit({ evaluate: async () => ({ ok: false }), isClosed: () => false }, {}),
    /NATIVE_QUIT_IPC_REJECTED/,
  )
  await assert.rejects(
    requestNativeQuit(
      {
        evaluate: async () => {
          throw new Error('UNRELATED_ERROR')
        },
        isClosed: () => true,
      },
      {},
    ),
    /UNRELATED_ERROR/,
  )
  await assert.rejects(
    requestNativeQuit({}, { exit: { code: 0, signal: null } }),
    /NATIVE_EXITED_BEFORE_REQUESTED_QUIT/,
  )
})

test('native readiness requires a committed exact app page, not an open debug socket or arbitrary target', () => {
  assert(
    hasCommittedAppTarget([{ type: 'page', url: 'contextweave://app/index.html#/environments' }]),
  )
  for (const value of [
    null,
    {},
    [],
    [{ type: 'page', url: 'about:blank' }],
    [{ type: 'other', url: 'contextweave://app/index.html' }],
    [{ type: 'page', url: 'contextweave://other/index.html' }],
    [{ type: 'page', url: 'contextweave://app/index.html?altered=1' }],
    [{ type: 'page', url: 'contextweave://user@app/index.html' }],
  ])
    assert.equal(hasCommittedAppTarget(value), false)
})

test(
  'polling also bounds an asynchronous readiness predicate without extending its budget',
  { timeout: 1000 },
  async () => {
    await assert.rejects(
      until(() => new Promise(() => {}), 10, 'ASYNC_PREDICATE_DEADLINE'),
      /ASYNC_PREDICATE_DEADLINE/,
    )
  },
)

test('transient loopback discovery failures stay within the original overall readiness budget', async () => {
  let calls = 0
  const request = async (_url, options) => {
    assert.equal(options.redirect, 'error')
    assert(options.signal instanceof AbortSignal)
    if (++calls === 1) throw new DOMException('fixture', 'TimeoutError')
    return { ok: true, json: async () => [{ type: 'page', url: 'contextweave://app/index.html' }] }
  }
  assert.equal(
    await until(
      () => probeCommittedAppTarget('http://127.0.0.1:1/json/list', request),
      1000,
      'ORIGINAL_BUDGET',
    ),
    true,
  )
  assert.equal(calls, 2)
  const unavailable = async () => {
    throw new TypeError('fixture', { cause: { code: 'ECONNREFUSED' } })
  }
  await assert.rejects(
    until(
      () => probeCommittedAppTarget('http://127.0.0.1:1/json/list', unavailable),
      25,
      'ORIGINAL_BUDGET',
    ),
    /ORIGINAL_BUDGET/,
  )
})

test('discovery never treats bad HTTP, invalid JSON or non-transport errors as startup success', async () => {
  await assert.rejects(
    probeCommittedAppTarget('http://127.0.0.1:1/json/list', async () => ({ ok: false })),
    /NATIVE_RENDERER_DISCOVERY_FAILED/,
  )
  const invalid = new SyntaxError('fixture')
  await assert.rejects(
    probeCommittedAppTarget('http://127.0.0.1:1/json/list', async () => ({
      ok: true,
      json: async () => {
        throw invalid
      },
    })),
    (actual) => actual === invalid,
  )
  const other = new TypeError('fixture', { cause: { code: 'EPERM' } })
  await assert.rejects(
    probeCommittedAppTarget('http://127.0.0.1:1/json/list', async () => {
      throw other
    }),
    (actual) => actual === other,
  )
})
