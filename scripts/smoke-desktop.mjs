import { assertWorkspaceIdentity, verifyWorkspaceUpgrade } from './smoke-workspace.mjs'
import { verifyScreenshotBudget } from './smoke-artifact-budget.mjs'
import { assertRegisteredScreenshot, verifyArtifactRestart } from './smoke-artifacts.mjs'
import { verifyManagerReopen } from './smoke-window-lifecycle.mjs'
import { runWorkerWithHostileEnvironment, finishCancelledNavigation, assertUtilityWorkersExited } from './smoke-worker-safety.mjs'
import { installRuntimeDiagnostics, readRuntimeDiagnostics, readRuntimeFailureEvidence, restoreRuntimeDiagnostics } from './smoke-runtime-diagnostics.mjs'
import { connectManagedBrowser, verifyDetachedControlSession } from './smoke-control.mjs'
// End-to-end regression for the sandboxed bridge and native environment lifecycle.
import { existsSync } from 'node:fs'
import { findPackagedArchive } from './release-tools.mjs'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile, realpath, cp } from 'node:fs/promises'
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
// Run the exact ASAR with the matching Electron runtime outside the repository, so missing
// production dependencies cannot accidentally resolve from workspace node_modules. This is
// bundle/lifecycle validation, not a substitute for exercising OS installers or code signing.
let entry = appRoot
if (process.argv.includes('--packaged')) {
  const { version } = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const archive = findPackagedArchive(join(appRoot, 'release', version))
  // '~' reproduces Windows short temp paths: legacy loadFile URL serialization differs.
  entry = join(directory, 'packaged ~', 'app.asar')
  await cp(archive, entry)
  if (existsSync(`${archive}.unpacked`))
    await cp(`${archive}.unpacked`, `${entry}.unpacked`, { recursive: true })
}
const desktop = await _electron.launch({
  executablePath: require('electron'),
  args: [entry],
  env: { ...process.env, CONTEXTWEAVE_USER_DATA: directory },
  timeout: 20000,
})
let id, fixtureServer, localeProxy, workspaceIdentity
let preserveSmokeDirectory = false
let completed = false
const registeredArtifacts = []
const controlClients = []
try {
  const page = await desktop.firstWindow()
  await page.waitForFunction(
    () => typeof window.contextweave?.events?.onDataChanged === 'function',
    undefined,
    { timeout: 10000 },
  )
  workspaceIdentity = await assertWorkspaceIdentity((...args) => page.evaluate(...args))
  assert.equal(await page.evaluate(() => typeof window.contextweave.acquireControlLease), 'undefined')
  assert.equal(
    await page.evaluate(() => typeof window.__electronLog),
    'undefined',
    'No third-party logger API may bypass the typed preload whitelist',
  )
  assert.deepEqual(
    await desktop.evaluate(({ ipcMain, session }) => ({
      logListeners: ipcMain.listenerCount('__ELECTRON_LOG__'),
      logPreloads: session.defaultSession
        .getPreloadScripts()
        .filter((script) => script.filePath.includes('electron-log')).length,
    })),
    { logListeners: 0, logPreloads: 0 },
    'Main-only logging must not register renderer IPC or session preload scripts',
  )
  for (const method of ['cleanupStatus', 'retryCleanup']) {
    const status = await page.evaluate(async (method) => window.contextweave.proxy[method]({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }), method)
    if (!status.ok)
      console.error(JSON.stringify({ bridgeFailure: status.code, rendererUrl: page.url() }))
    assert.deepEqual(
      status,
      { ok: true, data: { pendingCount: 0, temporaryFilesPending: false } },
      'Credential maintenance must cross the validated bridge',
    )
  }
  const imported = await page.evaluate(async () =>
    window.contextweave.proxy.import({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
      text: [
        'http://127.0.0.1:18101',
        'https://127.0.0.1:18102',
        'socket5://127.0.0.1:18103',
        'http://127.0.0.1:18101',
        'invalid-proxy',
      ].join('\n'),
      defaultType: 'http',
    }),
  )
  assert(imported.ok, 'Batch import must cross the validated bridge')
  assert.deepEqual(
    imported.data.map((row) => row.status),
    ['created', 'created', 'created', 'skipped', 'error'],
  )
  const proxies = await page.evaluate(async () => window.contextweave.proxy.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(proxies.ok)
  assert.deepEqual(proxies.data.map((proxy) => proxy.type).sort(), ['http', 'https', 'socks5'])
  // No public network dependency: a local rejecting proxy must see the IP request,
  // and a failure must not retry the provider over the host's direct route.
  const tunnels = []
  localeProxy = createServer((_request, response) => {
    response.writeHead(404)
    response.end()
  })
  localeProxy.on('connect', (request, socket) => {
    tunnels.push(request.url)
    socket.on('error', () => {})
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
  })
  localeProxy.listen(0, '127.0.0.1')
  await once(localeProxy, 'listening')
  const proxy = await page.evaluate(
    async (port) =>
      window.contextweave.proxy.save({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
        config: { type: 'http', host: '127.0.0.1', port },
      }),
    localeProxy.address().port,
  )
  assert(proxy.ok)
  const detected = await page.evaluate(
    async (proxyId) =>
      window.contextweave.environment.detectLocale({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
        requestId: crypto.randomUUID(),
        connection: 'proxy',
        proxyId,
      }),
    proxy.data.proxyId,
  )
  assert.deepEqual(detected, { ok: false, code: 'IP_LOCALE_FAILED', message: 'IP_LOCALE_FAILED' })
  assert.deepEqual(tunnels, ['ipwho.is:443'])
  assert(
    (
      await page.evaluate(
        async (proxyId) => window.contextweave.proxy.delete({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, proxyId),
        proxy.data.proxyId,
      )
    ).ok,
  )
  console.log(JSON.stringify({ ipLocaleProxyBoundary: 'passed-no-direct-fallback' }))
  const kernels = await page.evaluate(async () => window.contextweave.kernel.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
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
        credentialMaintenance: 'passed',
        batchProxyImport: 'passed',
        nativeLifecycle: 'not-run-no-local-browser',
        platform: process.platform,
        arch: process.arch,
      }),
    )
  } else {
    let onWorkerWait = () => {}
    let waitingResponse
    fixtureServer = createServer((request, response) => {
      if (request.url === '/worker-wait') {
        waitingResponse = response
        onWorkerWait()
        return
      }
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><title>ContextWeave worker fixture</title><h1>Safe screenshot</h1>',
      )
    })
    fixtureServer.listen(0, '127.0.0.1')
    await once(fixtureServer, 'listening')
    const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`
    const screenshots = []
    await installRuntimeDiagnostics(desktop)
    const created = await page.evaluate(async () =>
      window.contextweave.environment.create({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
        name: 'Desktop smoke fixture',
        kernelId: 'standard-chromium',
        commonConfig: { language: 'system', timezone: 'system' },
      }),
    )
    assert(created.ok, JSON.stringify(created))
    id = created.data.id
    const automatic = await page.evaluate(
      async ({ environmentId, expectedRevision }) =>
        window.contextweave.environment.update({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
          version: 1,
          environmentId,
          expectedRevision,
          name: 'Desktop smoke fixture',
          proxyId: null,
          browserSettings: {
            language: 'auto',
            timezone: 'auto',
            window: { width: 1440, height: 900 },
          },
        }),
      { environmentId: id, expectedRevision: created.data.revision },
    )
    assert(automatic.ok, JSON.stringify(automatic))
    const automaticDetail = await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(
      automaticDetail.ok &&
        automaticDetail.data.browserSettings.language === 'auto' &&
        automaticDetail.data.browserSettings.timezone === 'auto',
    )
    const manual = await page.evaluate(
      async ({ environmentId, expectedRevision }) =>
        window.contextweave.environment.update({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
          version: 1,
          environmentId,
          expectedRevision,
          name: 'Desktop smoke fixture',
          proxyId: null,
          browserSettings: {
            language: 'system',
            timezone: 'system',
            window: { width: 1440, height: 900 },
          },
        }),
      { environmentId: id, expectedRevision: automatic.data.revision },
    )
    assert(manual.ok, JSON.stringify(manual))
    for (let run = 0; run < 2; run++) {
      const started = await page.evaluate(async (id) => window.contextweave.environment.start({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
      assert(
        started.ok,
        JSON.stringify({
          run,
          started,
          control: started.ok ? undefined : await readRuntimeDiagnostics(desktop),
          environment: await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id),
        }),
      )
      assert.equal(started.data.status, 'running')
      const lock = JSON.parse(
        await readFile(
          join(directory, 'contextweave', 'environments', id, '.runtime.lock'),
          'utf8',
        ),
      )
      if (!lock.processIdentity && process.platform === 'win32') {
        assert(Number.isSafeInteger(lock.pid) && lock.pid > 0)
        const diagnostic = await new Promise((resolve) =>
          execFile(
            join(
              process.env.SystemRoot ?? 'C:\\Windows',
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'powershell.exe',
            ),
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(${lock.pid}).StartTime.ToUniversalTime().Ticks.ToString()`,
            ],
            { timeout: 10000, maxBuffer: 4096, windowsHide: true },
            (error, stdout, stderr) =>
              resolve({
                code: error?.code ?? null,
                killed: error?.killed ?? false,
                stdout,
                stderr,
              }),
          ),
        )
        // Fixture-only diagnosis; never weakens the assertion or rewrites application ownership.
        console.error(JSON.stringify({ missingIdentityPid: lock.pid, diagnostic }))
      }
      assert(lock.processIdentity, 'New locks must capture the OS process start identity')
      const processEvidence = (await readRuntimeDiagnostics(desktop)).find((record) => record.pid === lock.pid)
      assert(processEvidence && processEvidence.sentBytes > 0 && processEvidence.receivedBytes > 0, 'The actual owned browser must exchange data on its private pipe')
      assert.deepEqual(processEvidence.controlArguments, ['--remote-debugging-pipe'])
      const browser = await connectManagedBrowser(desktop, id, lock.controlPort)
      const context = browser.contexts()[0]
      const controlState = { run, disconnected: false, closedPages: 0, crashedPages: 0 }
      controlClients.push(controlState)
      browser.once('disconnected', () => { controlState.disconnected = true })
      const observedPages = new WeakSet()
      const observePage = (tab) => {
        if (observedPages.has(tab)) return
        observedPages.add(tab)
        tab.once('close', () => { controlState.closedPages++ })
        tab.once('crash', () => { controlState.crashedPages++ })
      }
      for (const tab of context.pages()) observePage(tab)
      context.on('page', observePage)
      const expectedTabs = [`${fixtureUrl}/?saved=one`, `${fixtureUrl}/?saved=two`]
      if (run === 0) {
        // CDP can be ready before Chromium creates its initial tab (notably on Windows).
        // Creating a replacement here races that native tab and makes a three-tab fixture.
        const first = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 10000 }))
        await first.goto(expectedTabs[0])
        await verifyDetachedControlSession(desktop, id, browser)
        await (await context.newPage()).goto(expectedTabs[1])
      } else {
        const deadline = Date.now() + 10000
        while (
          !expectedTabs.every((url) => context.pages().some((tab) => tab.url() === url)) &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 100))
        assert(
          expectedTabs.every((url) => context.pages().some((tab) => tab.url() === url)),
          JSON.stringify({
            message: 'Both tabs must be restored natively after closing the browser',
            urls: context.pages().map((tab) => tab.url()),
          }),
        )
      }
      if (run === 1) await verifyScreenshotBudget((fn, arg) => page.evaluate(fn, arg), directory, id, fixtureUrl)
      const screenshot = await runWorkerWithHostileEnvironment(desktop, page, {
        protocolVersion: 1,
        taskId: `task-smoke-${run}`,
        environmentId: id,
        kind: 'browser-smoke',
        input: { url: fixtureUrl, timeoutMs: 10000 },
      }, directory)
      assert(screenshot.ok && screenshot.data.ok, JSON.stringify({ run, screenshot }))
      const capturedPage = context.pages().find((tab) => tab.url() === `${fixtureUrl}/`)
      assert(capturedPage, 'The screenshot task must use an existing fixture page')
      assert.equal(
        await capturedPage.evaluate(() => document.visibilityState),
        'visible',
        'The Worker must activate its own selected tab before taking a headful screenshot',
      )
      assert.equal(screenshot.data.title, 'ContextWeave worker fixture')
      const screenshotPath = screenshot.data.screenshotPath
      const outputRoot = await realpath(join(directory, 'contextweave', 'worker-results'))
      // Node and Electron may represent the same Windows temp root using long or 8.3 names.
      const canonicalScreenshot = await realpath(screenshotPath)
      assert.equal(dirname(dirname(canonicalScreenshot)), outputRoot)
      assert.match(basename(dirname(canonicalScreenshot)), /^run-[A-Za-z0-9]+$/)
      assert.equal(basename(screenshotPath), 'screenshot.png')
      const png = await readFile(screenshotPath)
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      registeredArtifacts.push(await assertRegisteredScreenshot((fn, argument) => page.evaluate(fn, argument), screenshot, png, run + 1))
      screenshots.push(screenshotPath)
      if (run === 0) {
        const navigationSeen = new Promise((resolve) => { onWorkerWait = resolve })
        const cancellation = page.evaluate(async ({ environmentId, url }) => window.contextweave.worker.runSmoke({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
          protocolVersion: 1,
          taskId: 'task-cancel-smoke',
          environmentId,
          kind: 'browser-smoke',
          input: { url, timeoutMs: 10000 },
        }), { environmentId: id, url: `${fixtureUrl}/worker-wait` })
        void cancellation.catch(() => {})
        let waitTimer
        try {
          await Promise.race([navigationSeen, new Promise((_resolve, reject) => {
            waitTimer = setTimeout(() => reject(new Error('Worker did not navigate before cancellation')), 15000)
          })])
          assert.deepEqual(await page.evaluate(async () => window.contextweave.worker.cancel({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, 'task-cancel-smoke')), { ok: true, data: true })
          assert.deepEqual(await cancellation, { ok: false, code: 'CANCELLED', message: 'CANCELLED' })
          await assertUtilityWorkersExited(desktop)
          const { readdir } = await import('node:fs/promises')
          assert.equal((await readdir(outputRoot)).length, 1, 'Cancellation must not retain partial output')
        } finally {
          clearTimeout(waitTimer)
          if (waitingResponse) await finishCancelledNavigation(context, `${fixtureUrl}/worker-wait`, () => waitingResponse.end('<!doctype html><title>Cancelled fixture</title>'))
        }
      }
      // Independent CDP clients can enumerate pages in different orders. The smoke
      // worker navigates its first page, which is not necessarily our first page.
      // Normalize both existing pages before testing persistence (do not create replacements).
      if (run === 0) {
        const savedPages = context.pages()
        assert.equal(
          savedPages.length,
          expectedTabs.length,
          JSON.stringify({ urls: savedPages.map((tab) => tab.url()) }),
        )
        for (const [index, tab] of savedPages.entries()) await tab.goto(expectedTabs[index])
      }
      const duplicate = await page.evaluate(async (id) => window.contextweave.environment.start({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
      assert(!duplicate.ok, 'Duplicate launch must not create a second session')
      const blocked = await page.evaluate(async (id) => window.contextweave.environment.delete({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
      assert(!blocked.ok, 'A running profile cannot move to trash')
      if (run === 0) {
        const control = await browser.newBrowserCDPSession()
        await control.send('Browser.close').catch(() => {})
      } else {
        const tabs = context.pages()
        await tabs[0].close()
        const stillRunning = await page.evaluate(
          async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id),
          id,
        )
        assert(
          stillRunning.ok && stillRunning.data.status === 'running',
          'Closing one tab must not stop other tabs',
        )
        for (const tab of context.pages()) await tab.close().catch(() => {})
      }
      let stopped
      const closeDeadline = Date.now() + 15000
      do {
        stopped = await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
        if (stopped.ok && stopped.data.status === 'stopped') break
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < closeDeadline)
      assert(
        stopped.ok && stopped.data.status === 'stopped',
        JSON.stringify({ message: 'Closing the browser must stop the environment without a manual stop command', run, stopped, control: await readRuntimeDiagnostics(desktop), sessions: (await page.evaluate(async () => window.contextweave.activity.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))).data }),
      )
    }
    assert.equal(new Set(screenshots).size, 2, 'Every task must have a separately allocated output')
    const sessions = await page.evaluate(async () => window.contextweave.activity.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
    assert(sessions.ok)
    assert.equal(sessions.data.length, 2)
    assert(
      sessions.data.every(
        (session) =>
          session.endedAt && session.revision === manual.data.revision && session.executableVersion,
      ),
    )
    const before = await readFile(
      join(directory, 'contextweave', 'environments', id, 'Default', 'Preferences'),
      'utf8',
    )
    const removed = await page.evaluate(async (id) => window.contextweave.environment.delete({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(removed.ok)
    const trash = await page.evaluate(async () => window.contextweave.environment.trash({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
    assert(trash.ok && trash.data[0].id === id)
    const restored = await page.evaluate(async (id) => window.contextweave.environment.restore({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(restored.ok && restored.data.id === id)
    const after = await readFile(
      join(directory, 'contextweave', 'environments', id, 'Default', 'Preferences'),
      'utf8',
    )
    assert.equal(after, before)
    const pagedSessions = await page.evaluate(async () => window.contextweave.activity.page({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { limit: 2 }))
    assert(
      pagedSessions.ok && pagedSessions.data.items.length <= 2 && pagedSessions.data.previousCursor === null,
    )
    assert(pagedSessions.data.items.every((row) => !('pid' in row) && !('processIdentity' in row)))
    const operations = await page.evaluate(async () => window.contextweave.operation.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
    assert(operations.ok && operations.data.some((item) => item.errorCode === 'ALREADY_RUNNING'))
    // Finite, distinct fresh profiles, not retries of a failed startup. Any failure stops the gate.
    for (let sample = 0; sample < 3; sample++) {
      const fresh = await page.evaluate(async (sample) => window.contextweave.environment.create({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
        name: `Fresh-profile launch ${sample}`,
        kernelId: 'standard-chromium',
        commonConfig: { language: 'system', timezone: 'system' },
      }), sample)
      assert(fresh.ok)
      const started = await page.evaluate(async (id) => window.contextweave.environment.start({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), fresh.data.id)
      assert(started.ok, JSON.stringify({ sample, started, control: await readRuntimeDiagnostics(desktop) }))
      const stopped = await page.evaluate(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), fresh.data.id)
      assert(stopped.ok && stopped.data.status === 'stopped', JSON.stringify({ sample, stopped, control: await readRuntimeDiagnostics(desktop) }))
    }
    console.log(
      JSON.stringify({
        bridge: 'passed',
        credentialMaintenance: 'passed',
        batchProxyImport: 'passed',
        nativeLifecycle: 'passed',
        additionalFreshProfiles: 3,
        nativeExecutable: (await readRuntimeDiagnostics(desktop))[0]?.executable,
        executableVersion: sessions.data[0].executableVersion,
        reopen: 'passed',
        restoredTabs: 'passed',
        browserCloseStops: 'passed',
        trashRestore: 'passed',
        duplicateLaunch: 'blocked',
        runningDelete: 'blocked',
        workerScreenshot: 'passed-utility-process-main-owned-chunks',
        workerNodeInjection: 'rejected-in-actual-utility-child',
        workerCancellation: 'passed-actual-exit-and-output-cleanup',
        privateControl: 'pipe-with-one-use-authenticated-broker',
        sessions: sessions.data.length,
        platform: process.platform,
        arch: process.arch,
      }),
    )
  }
  if (process.platform === 'darwin')
    await verifyManagerReopen(desktop, page, {
      executable: require('electron'), entry,
      env: { CONTEXTWEAVE_USER_DATA: directory },
    })
  completed = true
} catch (error) {
  preserveSmokeDirectory = error?.preserveSmokeDirectory === true
  // Capture before cleanup changes the process/transport state. No URL, payload,
  // headers, credential, arbitrary error message or screenshot bytes are recorded.
  const manager = desktop.windows()[0]
  let runtimeStates = []
  if (manager) {
    try {
      runtimeStates = await manager.evaluate(async () => {
        const result = await window.contextweave.activity.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId })
        return result.ok ? result.data.slice(0, 8).map((session) => ({
          status: session.status,
          exitReason: session.exitReason === null ? null : /^[A-Z_]{1,80}$/.test(session.exitReason) ? session.exitReason : 'REDACTED_EXIT_REASON',
        })) : []
      })
    } catch { /* Keep the original failure if the manager is already unavailable. */ }
  }
  console.error(JSON.stringify({ runtimeFailureEvidence: await readRuntimeFailureEvidence(desktop).catch(() => ({ unavailable: true })), runtimeStates, controlClients }))
  throw error
} finally {
  await restoreRuntimeDiagnostics(desktop)
  try {
    if (id) {
      const page = desktop.windows()[0]
      if (page) await page.evaluate(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    }
  } catch {
    /* Preserve the original test error; application shutdown also stops owned children. */
  }
  await desktop.close()
  try {
    if (completed) {
      await verifyArtifactRestart(entry, directory, registeredArtifacts, workspaceIdentity)
      // The isolated ASAR lives inside directory and must still exist for this second fixture.
      await verifyWorkspaceUpgrade(entry)
    }
  } finally {
    if (localeProxy) await new Promise((resolve) => localeProxy.close(resolve))
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve))
    if (!preserveSmokeDirectory)
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

// The startup harness separately exercises the development bundle with injected native dialogs.
if (!process.argv.includes('--packaged')) await import('./smoke-startup.mjs')
else
  console.log(
    JSON.stringify({
      isolatedPackagedBundle: 'passed',
      platform: process.platform,
      arch: process.arch,
    }),
  )
