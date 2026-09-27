import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { withDeadline } from './native-packaged-host.mjs'
import { waitForBatchTask } from './smoke-batches.mjs'

export async function waitForEnvironmentCommand(read, { now = () => performance.now(), pause = () => delay(100), timeoutMs = 45000 } = {}) {
  const deadline = now() + timeoutMs
  for (;;) {
    const result = await withDeadline(Promise.resolve().then(read), Math.max(1, deadline - now()), 'COMMAND_RESULT_TIMEOUT')
    assert(result.ok, `COMMAND_RESULT_QUERY_FAILED: ${result.code ?? 'UNKNOWN'}`)
    if (!['queued', 'running'].includes(result.data.status)) return result.data
    assert(now() < deadline, `COMMAND_RESULT_TIMEOUT: ${result.data.status}`)
    await pause()
  }
}
async function invoke(page, method, payload) {
  return page.evaluate(async ({ method, payload }) => {
    const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
    return window.contextweave.environment[method](context, payload)
  }, { method, payload })
}
const finish = (page, requestId) => waitForEnvironmentCommand(() => invoke(page, 'commandReceipt', requestId))
async function execute(page, request) {
  const admitted = await invoke(page, 'submitCommand', request)
  assert(admitted.ok, `COMMAND_ADMISSION_FAILED: ${admitted.code}`)
  const receipt = await finish(page, request.requestId)
  assert.equal(receipt.status, 'succeeded', `COMMAND_${request.kind}_FAILED: ${receipt.errorCode}`)
  return receipt
}

// The production public bridge, database, queue and real browser runtime are used throughout.
export async function verifyEnvironmentCommands(page) {
  const requests = [], receipts = []
  const create = { requestId: randomUUID(), kind: 'create', input: { name: 'Stable command A', kernelId: 'standard-chromium', commonConfig: { language: 'system', timezone: 'system' } } }
  const duplicates = await page.evaluate(async (request) => {
    const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
    return Promise.all([window.contextweave.environment.submitCommand(context, request), window.contextweave.environment.submitCommand(context, request)])
  }, create)
  assert(duplicates.every((result) => result.ok), 'DUPLICATE_CREATE_ADMISSION_FAILED')
  assert.equal(duplicates[0].data.environmentId, duplicates[1].data.environmentId)
  const created = await finish(page, create.requestId)
  assert.equal(created.status, 'succeeded')
  const other = { ...create, requestId: randomUUID(), input: { ...create.input, name: 'Stable command B' } }
  const createdB = await execute(page, other)
  requests.push(create, other); receipts.push(created, createdB)
  const detail = await invoke(page, 'get', created.environmentId)
  assert(detail.ok)
  const update = { requestId: randomUUID(), kind: 'update', input: { version: 1, environmentId: created.environmentId, expectedRevision: detail.data.revision, name: 'Stable command A updated', proxyId: null, browserSettings: detail.data.browserSettings } }
  const updated = await execute(page, update)
  assert.deepEqual(await invoke(page, 'submitCommand', update), { ok: true, data: updated })
  assert.equal((await invoke(page, 'get', created.environmentId)).data.revision, detail.data.revision + 1)
  const conflict = await invoke(page, 'submitCommand', { ...update, input: { ...update.input, name: 'Must not overwrite' } })
  assert.equal(conflict.code, 'COMMAND_INTENT_CONFLICT')
  const stale = { ...update, requestId: randomUUID() }
  assert((await invoke(page, 'submitCommand', stale)).ok)
  assert.equal((await finish(page, stale.requestId)).errorCode, 'CONFIG_CONFLICT')
  requests.push(update); receipts.push(updated)
  const a = await invoke(page, 'get', created.environmentId), b = await invoke(page, 'get', createdB.environmentId)
  assert(a.ok && b.ok)
  const start = { requestId: randomUUID(), kind: 'start', environmentId: a.data.id, expectedRevision: a.data.revision }
  const admitted = await page.evaluate(async ({ request, environmentId }) => {
    const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
    const preview = await window.contextweave.batch.preview(context, { action: 'start', environmentIds: [environmentId] })
    if (!preview.ok) throw new Error(preview.code)
    return Promise.all([window.contextweave.environment.submitCommand(context, request), window.contextweave.batch.confirm(context, preview.data.id)])
  }, { request: start, environmentId: b.data.id })
  assert(admitted.every((result) => result.ok))
  const started = await finish(page, start.requestId)
  assert.equal(started.status, 'succeeded', started.errorCode ?? 'COMMAND_START_FAILED')
  const batch = await waitForBatchTask(() => page.evaluate(async id => window.contextweave.batch.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), admitted[1].data.id))
  assert.equal(batch.counts.succeeded, 1)
  const batchPage = await invoke(page, 'commandPage', { environmentId: b.data.id, limit: 10 })
  assert(batchPage.ok)
  const batchStart = batchPage.data.items.find(item => item.kind === 'start')
  assert(batchStart && batchStart.status === 'succeeded')
  const intervals = [started, batchStart].sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  assert(intervals[0].endedAt <= intervals[1].startedAt, 'SINGLE_AND_BATCH_STARTS_OVERLAPPED')
  assert.deepEqual(await invoke(page, 'submitCommand', start), { ok: true, data: started })
  requests.push(start); receipts.push(started)
  await page.reload()
  await page.waitForFunction(() => typeof window.contextweave?.environment?.commandReceipt === 'function', undefined, { timeout: 10000 })
  assert.deepEqual(await invoke(page, 'commandReceipt', start.requestId), { ok: true, data: started })
  const active = await invoke(page, 'activeCommands')
  assert(active.ok)
  assert.deepEqual(active.data.items, [], 'RUNNING_BROWSER_IS_NOT_AN_ACTIVE_COMMAND')
  const stops = [a.data, b.data].map(value => ({ requestId: randomUUID(), kind: 'stop', environmentId: value.id, expectedRevision: value.revision }))
  const stopped = await Promise.all(stops.map(request => execute(page, request)))
  requests.push(...stops); receipts.push(...stopped)
  const inspected = await invoke(page, 'inspectRecovery', a.data.id)
  assert(inspected.ok && inspected.data.canRecover && inspected.data.lockState === 'absent')
  for (const field of ['pid', 'dataDir', 'credential', 'token']) assert(!Object.hasOwn(inspected.data, field))
  console.log(JSON.stringify({ environmentCommands: 'real-public-ipc-duplicate-create-update-start', sharedStartQueue: 'single-and-batch-nonoverlapping-durable-intervals', revisionConflict: 'refused-without-mutation', reloadReceipt: 'exact-immutable-match', inspection: 'read-only-no-control-or-path' }))
  return { requests, receipts, starts: [started, batchStart] }
}

// App must be closed. This is an explicit interrupted-fact fixture, not a claim of a live OS crash.
export function seedInterruptedCommandFacts(directory, evidence) {
  if (!evidence) return undefined
  const sqlite = new DatabaseSync(join(directory, 'contextweave', 'contextweave.sqlite'))
  const interrupted = []
  try {
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM environment_commands WHERE status IN (\'queued\',\'running\')').get().n, 0)
    for (const [index, original] of evidence.starts.entries()) {
      const requestId = randomUUID(), status = index === 0 ? 'running' : 'queued', at = new Date().toISOString()
      const result = sqlite.prepare(`INSERT INTO environment_commands (request_id,kind,environment_id,expected_revision,intent_digest,status,created_at,started_at,ended_at,error_code)
        SELECT ?,kind,environment_id,expected_revision,intent_digest,?,?,?,NULL,NULL FROM environment_commands WHERE request_id=?`)
        .run(requestId, status, at, index === 0 ? at : null, original.requestId)
      assert.equal(result.changes, 1)
      interrupted.push({ requestId, kind: 'start', environmentId: original.environmentId, expectedRevision: original.expectedRevision })
    }
  } finally { sqlite.close() }
  return { ...evidence, interrupted }
}

export async function verifyEnvironmentCommandRestart(page, evidence) {
  if (!evidence) return
  for (const [index, request] of evidence.requests.entries()) {
    assert.deepEqual(await invoke(page, 'commandReceipt', request.requestId), { ok: true, data: evidence.receipts[index] })
    assert.deepEqual(await invoke(page, 'submitCommand', request), { ok: true, data: evidence.receipts[index] })
  }
  const beforeSessions = await page.evaluate(async () => window.contextweave.activity.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(beforeSessions.ok)
  for (const [index, request] of evidence.interrupted.entries()) {
    const result = await invoke(page, 'commandReceipt', request.requestId)
    assert(result.ok)
    assert.equal(result.data.status, index === 0 ? 'unknown' : 'cancelled')
    assert.equal(result.data.errorCode, 'COMMAND_INTERRUPTED')
    assert.deepEqual(await invoke(page, 'submitCommand', request), result, 'INTERRUPTED_COMMAND_REPLAYED')
    const detail = await invoke(page, 'get', request.environmentId)
    assert(detail.ok && detail.data.status === 'stopped')
    const inspection = await invoke(page, 'inspectRecovery', request.environmentId)
    assert(inspection.ok && inspection.data.canRecover)
    if (index === 0) {
      assert.equal(inspection.data.hasUnconfirmedCommand, true)
      const recover = { requestId: randomUUID(), kind: 'recover', environmentId: request.environmentId, expectedRevision: detail.data.revision }
      await execute(page, recover)
      assert.deepEqual(await invoke(page, 'commandReceipt', request.requestId), result, 'RECOVERY_REWROTE_UNKNOWN_RECEIPT')
      assert.equal((await invoke(page, 'inspectRecovery', request.environmentId)).data.hasUnconfirmedCommand, false)
    }
  }
  const afterSessions = await page.evaluate(async () => window.contextweave.activity.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert.deepEqual(afterSessions, beforeSessions, 'RESTART_RECEIPT_LOOKUP_SPAWNED_ANOTHER_BROWSER')
  console.log(JSON.stringify({ commandRestart: 'exact-receipts-survive-restart-and-duplicate-submission', interruptedFactFixture: 'running-to-unknown-queued-to-cancelled-no-replay', explicitRecovery: 'does-not-rewrite-unknown-fact', browserSessions: 'unchanged' }))
}
