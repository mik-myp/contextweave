import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForBatchTask } from './smoke-batches.mjs'

test('asynchronous false/active snapshots keep polling until the durable terminal fact', async () => {
  const snapshots = ['queued', 'running', 'cancelling', 'cancelled']
  let reads = 0, time = 0
  const task = await waitForBatchTask(async () => {
    await Promise.resolve()
    return { ok: true, data: { status: snapshots[reads++], counts: { cancelled: 1 } } }
  }, { now: () => time, pause: async () => { time += 100 } })
  assert.equal(reads, 4)
  assert.equal(time, 300)
  assert.equal(task.status, 'cancelled')
})

test('partial failure is returned unchanged, not treated as success or resubmitted', async () => {
  const data = { status: 'completed', counts: { failed: 1, succeeded: 1 } }
  const task = await waitForBatchTask(async () => ({ ok: true, data }), {
    pause: async () => assert.fail('Terminal facts must not poll again'),
  })
  assert.equal(task, data)
})

test('query failure fails immediately instead of hiding it behind retries', async () => {
  await assert.rejects(waitForBatchTask(async () => ({ ok: false, code: 'BATCH_STORAGE_FAILED' }), {
    pause: async () => assert.fail('Failed queries must not poll again'),
  }), /BATCH_RESULT_QUERY_FAILED: BATCH_STORAGE_FAILED/)
})

test('an active task retains the original 45-second deadline', async () => {
  let time = 0, reads = 0
  await assert.rejects(waitForBatchTask(async () => {
    reads++
    return { ok: true, data: { status: 'running', counts: { running: 1 } } }
  }, { now: () => time, pause: async () => { time += 15000 } }), /BATCH_RESULT_TIMEOUT/)
  assert.equal(time, 45000)
  assert.equal(reads, 4)
})


test('an unresponsive IPC query cannot outlive the bounded wait', async () => {
  await assert.rejects(waitForBatchTask(() => new Promise(() => {}), {
    timeoutMs: 10,
    pause: async () => assert.fail('A stalled query must not retry'),
  }), /BATCH_RESULT_TIMEOUT/)
})
