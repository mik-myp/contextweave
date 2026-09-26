// Only a test host: never imported by Main/Preload. No Node inspector or private IPC.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { chromium } = require('playwright-core')
export function cleanElectronEnvironment(overrides = {}) {
  const env = { ...process.env }
  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'NODE_EXTRA_CA_CERTS',
    'ELECTRON_RUN_AS_NODE',
    'CONTEXTWEAVE_USER_DATA',
    'ELECTRON_RENDERER_URL',
    'VITE_DEV_SERVER_URL',
  ])
    delete env[name]
  return { ...env, ...overrides }
}
export async function withDeadline(promise, milliseconds, code) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
export async function until(predicate, timeoutMs, code) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const value = await withDeadline(
      Promise.resolve().then(predicate),
      Math.max(1, deadline - performance.now()),
      code,
    )
    if (value) return value
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(25, Math.max(0, deadline - performance.now()))),
    )
  }
  throw new Error(code)
}
export function spawnOwned(executable, args, env = {}) {
  const child = spawn(executable, args, {
    env: cleanElectronEnvironment(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const state = { child, stdout: '', stderr: '', exit: undefined, spawnError: false }
  child.stdout.on('data', (chunk) => {
    state.stdout = (state.stdout + chunk.toString()).slice(-32768)
  })
  child.stderr.on('data', (chunk) => {
    state.stderr = (state.stderr + chunk.toString()).slice(-32768)
  })
  child.once('error', () => {
    state.spawnError = true
  })
  child.once('exit', (code, signal) => {
    state.exit = { code, signal }
  })
  return state
}
export async function stopOwned(state) {
  if (!state || state.exit || state.spawnError) return
  state.child.kill('SIGTERM')
  try {
    await until(() => state.exit, 5000, 'OWNED_PROCESS_TERM_TIMEOUT')
  } catch {
    state.child.kill('SIGKILL')
    await until(() => state.exit, 5000, 'OWNED_PROCESS_EXIT_UNCONFIRMED')
  }
}
export async function requestNativeQuit(page, state) {
  assert(!state.exit, 'NATIVE_EXITED_BEFORE_REQUESTED_QUIT')
  try {
    const result = await withDeadline(
      page.evaluate(() => window.contextweave.app.quit()),
      5000,
      'NATIVE_QUIT_IPC_TIMEOUT',
    )
    assert.deepEqual(result, { ok: true, data: true }, 'NATIVE_QUIT_IPC_REJECTED')
  } catch (error) {
    // Main schedules quit after replying, but destroying Renderer may win IPC delivery.
    // A lost reply is accepted only for a closed page and the actual clean OS exit below.
    if (!page.isClosed() || !/Target page, context or browser has been closed/.test(error.message))
      throw error
  }
  const exit = await until(() => state.exit, 10000, 'NATIVE_QUIT_TIMEOUT')
  assert.deepEqual(exit, { code: 0, signal: null }, 'NATIVE_QUIT_NOT_CLEAN')
}
export function hasCommittedAppTarget(targets) {
  return (
    Array.isArray(targets) &&
    targets.some((target) => {
      if (!target || target.type !== 'page' || typeof target.url !== 'string') return false
      try {
        const url = new URL(target.url)
        url.hash = ''
        return url.href === 'contextweave://app/index.html'
      } catch {
        return false
      }
    })
  )
}
export async function launchNative(layout, directory, options = {}) {
  const state = spawnOwned(
    layout.executable,
    [
      `--user-data-dir=${directory}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      ...(options.args ?? []),
    ],
    options.env,
  )
  let browser,
    page,
    isolated = false
  try {
    const endpoint = await until(
      () => {
        if (state.exit || state.spawnError) throw new Error('NATIVE_EXITED_BEFORE_RENDERER_READY')
        return state.stderr.match(
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+)/,
        )?.[1]
      },
      15000,
      'NATIVE_RENDERER_DEBUG_TIMEOUT',
    )
    // A listening DevTools socket is not an initialized Electron window. Observe a
    // committed native page before an automation client can pause newly born targets.
    // This replaces the old post-connect 10s page-event wait, not a longer deadline.
    const discovery = new URL(endpoint)
    discovery.protocol = 'http:'
    discovery.pathname = '/json/list'
    await until(
      async () => {
        if (state.exit || state.spawnError) throw new Error('NATIVE_EXITED_BEFORE_PAGE_COMMITTED')
        const response = await fetch(discovery, {
          redirect: 'error',
          signal: AbortSignal.timeout(1000),
        })
        assert(response.ok, 'NATIVE_RENDERER_DISCOVERY_FAILED')
        return hasCommittedAppTarget(await response.json())
      },
      10000,
      'NATIVE_PAGE_NOT_COMMITTED',
    )
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 })
    const context = browser.contexts()[0]
    page = context.pages()[0]
    assert(page, 'NATIVE_COMMITTED_PAGE_NOT_ATTACHED')
    await page.waitForFunction(() => !!window.contextweave?.app?.getPaths, undefined, {
      timeout: 10000,
    })
    const paths = await withDeadline(
      page.evaluate(() => window.contextweave.app.getPaths()),
      10000,
      'NATIVE_TYPED_PATHS_TIMEOUT',
    )
    assert(paths.ok, 'NATIVE_TYPED_PATHS_FAILED')
    assert.equal(
      await realpath(paths.data.userData),
      await realpath(directory),
      'NATIVE_USER_DATA_NOT_ISOLATED',
    )
    isolated = true
    const entry = new URL(page.url())
    entry.hash = ''
    assert.equal(entry.href, 'contextweave://app/index.html', 'NATIVE_UNEXPECTED_RENDERER_ENTRY')
    return {
      state,
      browser,
      page,
      async quit() {
        await requestNativeQuit(page, state)
      },
      async close() {
        // Successful callers quit through typed IPC; a failed test terminates only its owned child.
        if (!state.exit && isolated)
          await withDeadline(
            page.evaluate(() => window.contextweave.app.quit()),
            3000,
            'NATIVE_CLEANUP_IPC_TIMEOUT',
          ).catch(() => {})
        await stopOwned(state)
        await browser.close()
      },
    }
  } catch (error) {
    error.nativeEvidence = {
      exit: state.exit ?? null,
      spawnError: state.spawnError,
      pageCount:
        browser?.contexts().reduce((count, context) => count + context.pages().length, 0) ?? 0,
      integrityRejected: /Integrity check failed for asar archive/i.test(state.stderr),
      fileLoadFailed: /ERR_FILE_NOT_FOUND/.test(state.stderr),
      uiLoadFailed: /UI_LOAD_FAILED/.test(state.stderr),
    }
    if (page && isolated && !state.exit)
      await withDeadline(
        page.evaluate(() => window.contextweave.app.quit()),
        3000,
        'NATIVE_CLEANUP_IPC_TIMEOUT',
      ).catch(() => {})
    try {
      await stopOwned(state)
    } catch {
      console.error('NATIVE_CLEANUP_UNCONFIRMED_RETAIN_FIXTURE')
    }
    await browser?.close().catch(() => {})
    error.nativeProcessUnconfirmed = !state.exit && !state.spawnError
    throw error
  }
}
