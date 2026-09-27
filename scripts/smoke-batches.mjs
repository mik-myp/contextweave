import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { withDeadline } from './native-packaged-host.mjs'

// Poll durable facts in the host. Playwright's waitForFunction treats the
// Promise returned by an async predicate as truthy before its value resolves.
// This never re-submits a command and retains the original 45-second deadline.
export async function waitForBatchTask(read, { now = () => performance.now(), pause = () => delay(100), timeoutMs = 45000 } = {}) {
  const deadline = now() + timeoutMs
  while (true) {
    const result = await withDeadline(Promise.resolve().then(read), Math.max(1, deadline - now()), 'BATCH_RESULT_TIMEOUT')
    assert(result.ok, `BATCH_RESULT_QUERY_FAILED: ${result.code ?? 'UNKNOWN'}`)
    if (!['queued', 'running', 'cancelling'].includes(result.data.status)) return result.data
    assert(now() < deadline, `BATCH_RESULT_TIMEOUT: ${JSON.stringify({ status: result.data.status, counts: result.data.counts })}`)
    await pause()
  }
}

// Real public IPC and real browsers; no injected queue or renderer-owned scheduling.
export async function verifyBackendBatches(page, activateManager) {
  const ids = await page.evaluate(async () => {
    const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
    const ids = []
    for (const name of ['Batch native A', 'Batch native B']) {
      const created = await window.contextweave.environment.create(context, {
        name, kernelId: 'standard-chromium', commonConfig: { language: 'system', timezone: 'system' },
      })
      if (!created.ok) throw new Error(created.code)
      ids.push(created.data.id)
    }
    return ids
  })
  const submit = async (action, environmentIds) => page.evaluate(async ({ action, environmentIds }) => {
    const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
    const preview = await window.contextweave.batch.preview(context, { action, environmentIds })
    if (!preview.ok) return preview
    const task = await window.contextweave.batch.confirm(context, preview.data.id)
    if (!task.ok) return task
    const duplicate = await window.contextweave.batch.confirm(context, preview.data.id)
    if (!duplicate.ok || duplicate.data.id !== task.data.id) throw new Error('BATCH_CONFIRM_NOT_IDEMPOTENT')
    return task
  }, { action, environmentIds })
  const finish = async (id) => {
    const task = await waitForBatchTask(() => page.evaluate(async id => window.contextweave.batch.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id))
    assert.equal(task.status, 'completed')
    assert.equal(task.counts.succeeded, 2, JSON.stringify({ action: task.action, results: task.items.map(item => ({ status: item.status, reason: item.reason })) }))
    return task
  }
  const start = await submit('start', [...ids, 'missing-batch-target'])
  assert(start.ok, 'BATCH_START_CONFIRM_FAILED')
  const started = await finish(start.data.id)
  assert.equal(started.counts.skipped, 1)
  assert.equal(started.items.at(-1).reason, 'NOT_FOUND')
  assert.deepEqual(started.items.map(item => item.environmentId), [...ids, 'missing-batch-target'])
  const stop = await submit('stop', ids)
  assert(stop.ok, 'BATCH_STOP_CONFIRM_FAILED')
  assert(['queued', 'running'].includes(stop.data.status), 'BATCH_STOP_NOT_SUBMITTED_ACTIVE')
  // Navigate after confirming the stop task, while Main owns the work. Startup
  // intentionally foregrounds external browsers; a real user returns to the
  // manager before navigating. Stop does not launch another window to steal focus.
  const before = await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }))
  await activateManager()
  console.log(JSON.stringify({ batchNavigationWindow: { before, after: await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() })) } }))
  await page.getByRole('link', { name: '代理', exact: true }).click()
  await finish(stop.data.id)
  for (const action of ['trash', 'restore']) {
    const submitted = await submit(action, ids)
    assert(submitted.ok, `BATCH_${action.toUpperCase()}_CONFIRM_FAILED`)
    await finish(submitted.data.id)
  }
  await page.reload()
  await page.waitForFunction(() => typeof window.contextweave?.batch?.page === 'function')
  const stored = await page.evaluate(async id => window.contextweave.batch.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), start.data.id)
  assert(stored.ok, 'BATCH_RESULT_LOST_AFTER_RELOAD')
  assert.deepEqual(stored.data, started)
  await page.getByRole('link', { name: '环境', exact: true }).click()
  console.log(JSON.stringify({ backendBatches: 'real-ipc-preview-confirm-start-stop-trash-restore', navigation: 'main-owned-facts-retained-after-navigation-and-reload', duplicateConfirm: 'one-persisted-task', nativeTargets: 2 }))
}
