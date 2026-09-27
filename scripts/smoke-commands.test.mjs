import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForEnvironmentCommand } from './smoke-commands.mjs'

test('environment receipt polling awaits settled IPC values without replaying commands', async () => {
  const statuses = ['queued', 'running', 'unknown']
  let reads = 0, time = 0
  const result = await waitForEnvironmentCommand(async () => {
    await Promise.resolve()
    return { ok: true, data: { status: statuses[reads++] } }
  }, { now: () => time, pause: async () => { time += 100 } })
  assert.equal(reads, 3)
  assert.equal(time, 200)
  assert.equal(result.status, 'unknown')
})
test('receipt query errors are not suppressed as transient success or retried', async () => {
  await assert.rejects(waitForEnvironmentCommand(async () => ({ ok: false, code: 'COMMAND_STORAGE_FAILED' }), {
    pause: async () => assert.fail('Do not suppress query errors'),
  }), /COMMAND_RESULT_QUERY_FAILED: COMMAND_STORAGE_FAILED/)
})
test('receipt observation ends within its own fixed deadline', async () => {
  let time = 0
  await assert.rejects(waitForEnvironmentCommand(async () => ({ ok: true, data: { status: 'running' } }), {
    now: () => time, pause: async () => { time += 15000 },
  }), /COMMAND_RESULT_TIMEOUT/)
  assert.equal(time, 45000)
})
test('a hung receipt IPC does not block the host beyond its deadline', async () => {
  await assert.rejects(waitForEnvironmentCommand(() => new Promise(() => {}), { timeoutMs: 10 }), /COMMAND_RESULT_TIMEOUT/)
})
