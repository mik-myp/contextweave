// Only public typed policy/task APIs; rejected admission must not change disk or accounting.
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
export async function verifyScreenshotBudget(call, directory, environmentId, url) {
  const before = await call(async () => window.contextweave.storage.getArtifactBudget({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(before.ok && before.data.registered.count > 0 && before.data.reserved.count === 0, 'BUDGET_FIXTURE_NOT_SETTLED')
  const output = join(directory, 'contextweave', 'worker-results')
  const files = (await readdir(output)).sort()
  const lowered = await call(async (expectedRevision) => window.contextweave.storage.updateArtifactBudget({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { limitMiB: 32, expectedRevision }), before.data.revision)
  assert(lowered.ok && lowered.data.availableBytes < 33554432, 'BUDGET_NOT_LOWERED')
  const blocked = await call(async ({ environmentId, url }) => window.contextweave.worker.runSmoke({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { protocolVersion: 1, taskId: 'budget-exceeded-smoke', environmentId, kind: 'browser-smoke', input: { url, timeoutMs: 10000 } }), { environmentId, url })
  assert.deepEqual(blocked, { ok: false, code: 'ARTIFACT_BUDGET_EXCEEDED', message: 'ARTIFACT_BUDGET_EXCEEDED' })
  assert.deepEqual((await readdir(output)).sort(), files, 'REJECTED_BUDGET_ALLOCATED_OUTPUT')
  const after = await call(async () => window.contextweave.storage.getArtifactBudget({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(after.ok)
  assert.deepEqual(after.data, lowered.data, 'REJECTED_ADMISSION_CHANGED_ACCOUNTING')
  const running = await call(async id => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), environmentId)
  assert(running.ok && running.data.status === 'running', 'BUDGET_STOPPED_BROWSER')
  const restored = await call(async ({ limitMiB, expectedRevision }) => window.contextweave.storage.updateArtifactBudget({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { limitMiB, expectedRevision }), { limitMiB: before.data.limitMiB, expectedRevision: lowered.data.revision })
  assert(restored.ok && restored.data.revision === before.data.revision + 2)
  console.log(JSON.stringify({ screenshotBudget: 'durable-maximum-reservation-rejection-no-output-no-browser-stop-policy-restored', registeredBefore: before.data.registered.count }))
  // The caller's next actual Worker screenshot must succeed after this restored policy.
}
