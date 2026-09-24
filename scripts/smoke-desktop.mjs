// End-to-end regression for the sandboxed bridge and native environment lifecycle.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import assert from 'node:assert/strict'
// A trailing Windows backslash escapes the launcher's closing argument quote.
const appRoot = resolve(fileURLToPath(new URL('../apps/desktop/', import.meta.url)))
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron } = require('playwright-core')
const directory = await mkdtemp(join(tmpdir(), 'cw-desktop-smoke-'))
const desktop = await _electron.launch({
  executablePath: require('electron'),
  args: [appRoot],
  env: { ...process.env, CONTEXTWEAVE_USER_DATA: directory },
  timeout: 20000,
})
let id, fixtureServer
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
    kernels.data.every((item) => item.id === 'standard-chromium'),
    'Fresh installed list must not contain fingerprint placeholders',
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
    fixtureServer = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><title>ContextWeave worker fixture</title><h1>Safe screenshot</h1>',
      )
    })
    fixtureServer.listen(0, '127.0.0.1')
    await once(fixtureServer, 'listening')
    const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`
    const screenshots = []
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
      const screenshot = await page.evaluate(
        ({ environmentId, url, run }) =>
          window.contextweave.worker.runSmoke({
            protocolVersion: 1,
            taskId: `task-smoke-${run}`,
            environmentId,
            kind: 'browser-smoke',
            input: { url, timeoutMs: 10000 },
          }),
        { environmentId: id, url: fixtureUrl, run },
      )
      assert(screenshot.ok && screenshot.data.ok, JSON.stringify(screenshot))
      assert.equal(screenshot.data.title, 'ContextWeave worker fixture')
      const screenshotPath = screenshot.data.screenshotPath
      const outputRoot = await realpath(join(directory, 'contextweave', 'worker-results'))
      assert.equal(dirname(dirname(screenshotPath)), outputRoot)
      assert.equal(basename(screenshotPath), 'screenshot.png')
      const png = await readFile(screenshotPath)
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      screenshots.push(screenshotPath)
      const duplicate = await page.evaluate((id) => window.contextweave.environment.start(id), id)
      assert(!duplicate.ok, 'Duplicate launch must not create a second session')
      const blocked = await page.evaluate((id) => window.contextweave.environment.delete(id), id)
      assert(!blocked.ok, 'A running profile cannot move to trash')
      const stopped = await page.evaluate((id) => window.contextweave.environment.stop(id), id)
      assert(stopped.ok, JSON.stringify(stopped))
      assert.equal(stopped.data.status, 'stopped')
    }
    assert.equal(new Set(screenshots).size, 2, 'Every task must have a separately allocated output')
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
        workerScreenshot: 'passed-main-owned-descriptor',
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
  if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
