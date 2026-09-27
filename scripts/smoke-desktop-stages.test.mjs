import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { desktopStage, stopFailedDesktop } from './smoke-desktop-stages.mjs'

test('a stage waits for its real result without cleanup or a second invocation', async () => {
  const logs = []; let calls = 0
  const result = await desktopStage('fixture-read', async () => { calls++; return 42 }, {
    timeoutMs: 1000, log: value => logs.push(value),
    stop: async () => assert.fail('Successful checks must not force cleanup'),
  })
  assert.equal(result, 42)
  assert.equal(calls, 1)
  assert.deepEqual(logs.map(item => item.state), ['started', 'passed'])
})

test('timeout diagnoses and cleans up only the owned app, then still fails', async () => {
  const app = { process: () => ({ pid: 123 }) }; const logs = []; let calls = 0, stops = 0
  await assert.rejects(desktopStage('fixture-stuck', () => { calls++; return new Promise(() => {}) }, {
    timeoutMs: 10, app, log: value => logs.push(value),
    sample: async child => { assert.equal(child.pid, 123); return { status: 'sampled', frames: { inspector: 1 } } },
    stop: async owned => { assert.equal(owned, app); stops++ },
  }), /DESKTOP_STAGE_TIMEOUT/)
  assert.equal(calls, 1)
  assert.equal(stops, 1)
  assert.deepEqual(logs.map(item => item.state), ['started', 'failed'])
  assert.equal(logs[1].cleanup, 'owned-process-exited-after-failed-check')
})

test('errors are retained, but raw error text is not copied into diagnostics', async () => {
  const logs = []; const error = new Error('SENSITIVE_CANARY')
  await assert.rejects(desktopStage('fixture-error', () => { throw error }, {
    timeoutMs: 1000, app: { process: () => ({}) }, log: value => logs.push(value),
    sample: async () => { throw new Error('SENSITIVE_CANARY') },
    stop: async () => { throw new Error('SENSITIVE_CANARY') },
  }), actual => actual === error)
  assert.equal(error.preserveSmokeDirectory, true)
  assert.equal(JSON.stringify(logs).includes('SENSITIVE_CANARY'), false)
  assert.equal(logs[1].cleanup, 'exit-unconfirmed-retain-fixture')
})

test('cleanup tracks an actual child exit and removes its temporary listener', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })
  await stopFailedDesktop({ process: () => child }, async state => {
    assert.equal(state.child, child)
    assert.equal(state.exit, undefined)
    child.emit('exit', null, 'SIGTERM')
  })
  assert.equal(child.listenerCount('exit'), 0)
})

test('unconfirmed cleanup is not silently successful', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })
  await assert.rejects(stopFailedDesktop({ process: () => child }, async () => {}), /DESKTOP_EXIT_UNCONFIRMED/)
  assert.equal(child.listenerCount('exit'), 0)
})
