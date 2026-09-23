// End-to-end regression for the sandboxed bridge and native environment lifecycle.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const appRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron } = require('playwright-core')
const directory = await mkdtemp(join(tmpdir(), 'cw-desktop-smoke-'))
const desktop = await _electron.launch({
  executablePath: require('electron'),
  args: [appRoot],
  env: { ...process.env, CONTEXTWEAVE_USER_DATA: directory },
  timeout: 20000,
})
let id
try {
  const page = await desktop.firstWindow()
  await page.waitForFunction(
    () => typeof window.contextweave?.events?.onDataChanged === 'function',
    undefined,
    { timeout: 10000 },
  )
  const kernels = await page.evaluate(() => window.contextweave.kernel.list())
  assert(kernels.ok, 'Kernel list must cross the sandboxed IPC bridge')
  assert(
    kernels.data.find((item) => item.id === 'fingerprint-chromium')?.providerStatus ===
      'unconfigured',
  )
  const native = kernels.data.find(
    (item) => item.id === 'standard-chromium' && item.status === 'available',
  )
  if (!native) {
    assert(
      !process.argv.includes('--require-native'),
      'No local native browser available for the required lifecycle test',
    )
    console.log(
      JSON.stringify({
        bridge: 'passed',
        nativeLifecycle: 'not-run-no-local-browser',
        platform: process.platform,
        arch: process.arch,
      }),
    )
  } else {
    const created = await page.evaluate(() =>
      window.contextweave.environment.create({
        name: 'Desktop smoke fixture',
        kernelId: 'standard-chromium',
        commonConfig: { language: 'system', timezone: 'system' },
      }),
    )
    assert(created.ok, JSON.stringify(created))
    id = created.data.id
    for (let run = 0; run < 2; run++) {
      const started = await page.evaluate((id) => window.contextweave.environment.start(id), id)
      assert(started.ok, JSON.stringify(started))
      assert.equal(started.data.status, 'running')
      const duplicate = await page.evaluate((id) => window.contextweave.environment.start(id), id)
      assert(!duplicate.ok, 'Duplicate launch must not create a second session')
      const blocked = await page.evaluate((id) => window.contextweave.environment.delete(id), id)
      assert(!blocked.ok, 'A running profile cannot move to trash')
      const stopped = await page.evaluate((id) => window.contextweave.environment.stop(id), id)
      assert(stopped.ok, JSON.stringify(stopped))
      assert.equal(stopped.data.status, 'stopped')
    }
    const sessions = await page.evaluate(() => window.contextweave.activity.list())
    assert(sessions.ok)
    assert.equal(sessions.data.length, 2)
    assert(
      sessions.data.every(
        (session) => session.endedAt && session.revision === 1 && session.executableVersion,
      ),
    )
    const before = await readFile(
      join(directory, 'contextweave', 'environments', id, 'Default', 'Preferences'),
      'utf8',
    )
    const removed = await page.evaluate((id) => window.contextweave.environment.delete(id), id)
    assert(removed.ok)
    const trash = await page.evaluate(() => window.contextweave.environment.trash())
    assert(trash.ok && trash.data[0].id === id)
    const restored = await page.evaluate((id) => window.contextweave.environment.restore(id), id)
    assert(restored.ok && restored.data.id === id)
    const after = await readFile(
      join(directory, 'contextweave', 'environments', id, 'Default', 'Preferences'),
      'utf8',
    )
    assert.equal(after, before)
    const operations = await page.evaluate(() => window.contextweave.operation.list())
    assert(operations.ok && operations.data.some((item) => item.errorCode === 'ALREADY_RUNNING'))
    console.log(
      JSON.stringify({
        bridge: 'passed',
        nativeLifecycle: 'passed',
        reopen: 'passed',
        trashRestore: 'passed',
        duplicateLaunch: 'blocked',
        runningDelete: 'blocked',
        sessions: sessions.data.length,
        platform: process.platform,
        arch: process.arch,
      }),
    )
  }
} finally {
  try {
    if (id) {
      const page = await desktop.firstWindow()
      await page.evaluate((id) => window.contextweave.environment.stop(id), id)
    }
  } catch {
    /* Preserve the original test error; application shutdown also stops owned children. */
  }
  await desktop.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
