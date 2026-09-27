import { assertWorkspaceIdentity } from './smoke-workspace.mjs'
import { recordWorkerFailure } from './smoke-worker-diagnostics.mjs'
import { verifyScreenshotBudget } from './smoke-artifact-budget.mjs'
import { assertRegisteredScreenshot } from './smoke-artifacts.mjs'
// Tests the actual hardened executable, not stock Electron loading app.asar.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findPackagedArchive } from './release-tools.mjs'
import {
  packagedLayout,
  readFuses,
  verifyEmbeddedIntegrity,
  verifyBundleSignature,
} from '../apps/desktop/build/electron-fuses.mjs'
import { launchNative, withDeadline } from './native-packaged-host.mjs'

const root = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const layout = packagedLayout(findPackagedArchive(join(root, 'release', version)), process.platform)
const directory = await mkdtemp(join(tmpdir(), 'cw-native-packaged-'))
let host,
  id,
  fixtureServer,
  waitingResponse,
  allowCleanup = true,
  failure
try {
  await readFuses(layout.fuseBinary)
  await verifyEmbeddedIntegrity(layout)
  if (process.platform === 'darwin') await verifyBundleSignature(layout.bundle)
  host = await launchNative(layout, directory)
  const { page } = host
  await page.waitForFunction(
    () => document.querySelectorAll('#root button').length > 0,
    undefined,
    { timeout: 10000 },
  )
  // getInfo also probes the real OS credential store, which is NOT isolated by --user-data-dir.
  // The packaged manifest is audited separately; this smoke must not prompt for the user's keychain.
  const call = (...args) => withDeadline(page.evaluate(...args), 35000, 'NATIVE_TYPED_API_TIMEOUT')
  await assertWorkspaceIdentity(call)
  const environments = await call(async () => window.contextweave.environment.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(environments.ok && environments.data.length === 0, 'NATIVE_PROFILE_NOT_FRESH')
  const cleanupReceipt = await call(async () => window.contextweave.storage.getHistoryCleanupReceipt({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert.deepEqual(cleanupReceipt, { ok: true, data: null }, 'NATIVE_HISTORY_RECEIPT_NOT_FRESH')
  const cleanupPreview = await call(async () => window.contextweave.storage.previewHistoryCleanup({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { retentionDays: 90 }))
  assert(cleanupPreview.ok, 'NATIVE_HISTORY_PREVIEW_FAILED')
  for (const kind of ['sessions', 'operations'])
    assert.deepEqual(cleanupPreview.data[kind], { count: 0, hasMore: false }, 'NATIVE_HISTORY_NOT_EMPTY')
  const emptyCleanup = await call(async (previewId) => window.contextweave.storage.confirmHistoryCleanup({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { previewId }), cleanupPreview.data.previewId)
  assert(!emptyCleanup.ok && emptyCleanup.code === 'HISTORY_CLEANUP_EMPTY', 'NATIVE_EMPTY_HISTORY_NOT_REJECTED')
  const kernels = await call(async () => window.contextweave.kernel.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(
    kernels.ok &&
      kernels.data.some(
        (kernel) => kernel.id === 'standard-chromium' && kernel.status === 'available',
      ),
    'NATIVE_REQUIRED_BROWSER_UNAVAILABLE',
  )
  let navigationSeen
  fixtureServer = createServer((request, response) => {
    if (request.url === '/wait') {
      waitingResponse = response
      navigationSeen?.()
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><title>Native packaged worker</title><h1>Loopback screenshot fixture</h1>',
    )
  })
  fixtureServer.listen(0, '127.0.0.1')
  await once(fixtureServer, 'listening')
  const url = `http://127.0.0.1:${fixtureServer.address().port}`
  const created = await call(async () =>
    window.contextweave.environment.create({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
      name: 'Native packaged fixture',
      kernelId: 'standard-chromium',
      commonConfig: { language: 'system', timezone: 'system' },
    }),
  )
  assert(created.ok, 'NATIVE_ENVIRONMENT_CREATE_FAILED')
  id = created.data.id
  for (let run = 0; run < 2; run++) {
    const started = await call(async (id) => window.contextweave.environment.start({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(started.ok, 'NATIVE_ENVIRONMENT_START_FAILED')
    if (run === 1) await verifyScreenshotBudget(call, directory, id, url)
    const screenshotStarted = performance.now()
    const screenshot = await call(
      async ({ environmentId, url, run }) =>
        window.contextweave.worker.runSmoke({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
          protocolVersion: 1,
          taskId: `native-screenshot-${run}`,
          environmentId,
          kind: 'browser-smoke',
          input: { url, timeoutMs: 10000 },
        }),
      { environmentId: id, url, run },
    )
    await recordWorkerFailure(screenshot, run, performance.now() - screenshotStarted, () =>
      withDeadline(page.evaluate(async (id) => ({
        budget: await window.contextweave.storage.getArtifactBudget({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }),
        environment: await window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id),
      }), id), 2000, 'NATIVE_WORKER_EVIDENCE_TIMEOUT'),
    )
    assert(screenshot.ok && screenshot.data.ok, 'NATIVE_UTILITY_SCREENSHOT_FAILED')
    assert.equal(screenshot.data.title, 'Native packaged worker')
    const outputRoot = await realpath(join(directory, 'contextweave/worker-results'))
    const path = await realpath(screenshot.data.screenshotPath)
    assert.equal(dirname(dirname(path)), outputRoot, 'NATIVE_OUTPUT_ESCAPED')
    assert.equal(basename(path), 'screenshot.png')
    const png = await readFile(path)
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    await assertRegisteredScreenshot(call, screenshot, png, run + 1)
    if (run === 0) {
      const seen = new Promise((resolve) => {
        navigationSeen = resolve
      })
      const cancelled = call(
        async ({ environmentId, url }) =>
          window.contextweave.worker.runSmoke({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
            protocolVersion: 1,
            taskId: 'native-cancel',
            environmentId,
            kind: 'browser-smoke',
            input: { url: `${url}/wait`, timeoutMs: 10000 },
          }),
        { environmentId: id, url },
      )
      void cancelled.catch(() => {})
      let timer
      try {
        await Promise.race([
          seen,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('NATIVE_CANCEL_NAVIGATION_NOT_OBSERVED')),
              10000,
            )
          }),
        ])
        assert.deepEqual(await call(async () => window.contextweave.worker.cancel({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, 'native-cancel')), {
          ok: true,
          data: true,
        })
        assert.deepEqual(await cancelled, { ok: false, code: 'CANCELLED', message: 'CANCELLED' })
        assert.equal((await readdir(outputRoot)).length, 1, 'NATIVE_CANCEL_LEFT_PARTIAL_OUTPUT')
      } finally {
        clearTimeout(timer)
        waitingResponse?.end('<!doctype html><title>Cancelled fixture</title>')
        navigationSeen = undefined
      }
    }
    const stopped = await call(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(stopped.ok, 'NATIVE_ENVIRONMENT_STOP_FAILED')
    const detail = await call(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(detail.ok && detail.data.status === 'stopped', 'NATIVE_ENVIRONMENT_NOT_STOPPED')
  }
  const deleted = await call(async (id) => window.contextweave.environment.delete({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
  assert(deleted.ok, 'NATIVE_ENVIRONMENT_DELETE_FAILED')
  id = undefined
  await host.quit()
} catch (error) {
  failure = error
  allowCleanup = !error.nativeProcessUnconfirmed
  throw error
} finally {
  let cleanupFailure
  if (host && !host.state.exit && id) {
    const result = await withDeadline(
      host.page.evaluate(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id),
      10000,
      'NATIVE_CLEANUP_STOP_TIMEOUT',
    ).catch(() => undefined)
    if (!result?.ok) allowCleanup = false
  }
  try {
    await host?.close()
  } catch (error) {
    allowCleanup = false
    cleanupFailure = error
    console.error('NATIVE_CLEANUP_FAILED')
  }
  waitingResponse?.end()
  fixtureServer?.closeAllConnections()
  fixtureServer?.close()
  if (allowCleanup) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      cleanupFailure ??= error
      console.error('NATIVE_FIXTURE_CLEANUP_FAILED')
    }
  } else console.error('NATIVE_FIXTURE_RETAINED_AFTER_UNCONFIRMED_CLEANUP')
  if (!failure && cleanupFailure) throw cleanupFailure
}

console.log(
  JSON.stringify({
    nativePackagedExecutable: 'passed',
    nativeArtifactInventory: 'two-real-registered-screenshots-sha256-bytes',
    nativeHistoryMaintenance: 'passed-empty-preview-receipt-confirm-guard',
    fuses: 'all-nine-policy-readback',
    utilityWorker: 'two-screenshots-and-real-navigation-cancel-passed',
    lifecycle: 'start-stop-restart-delete-quit',
    userData: 'isolated-via-existing-typed-api',
    version,
    platform: process.platform,
    arch: process.arch,
  }),
)
