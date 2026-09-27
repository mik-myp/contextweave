import { sampleOwnedMain } from './smoke-window-diagnostics.mjs'
// Stock-Electron smoke only; no product API or native-Fuses test bypass is added.
import assert from 'node:assert/strict'
import { spawnOwned, stopOwned, until, withDeadline } from './native-packaged-host.mjs'

export async function reopenAfterNativeClose(desktop, page, trigger, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = deadline - performance.now()
    assert(value > 0, 'MANAGER_REOPEN_DEADLINE')
    return value
  }
  // CDP page.close() destroys a WebContents target without exercising the native
  // BrowserWindow close entry point. Use the actual window and arm 'closed' before
  // calling close(), so a veto/hang cannot be mistaken for native destruction.
  const window = await withDeadline(
    desktop.browserWindow(page),
    remaining(),
    'MANAGER_NATIVE_WINDOW_UNAVAILABLE',
  )
  try {
    const closed = await withDeadline(
      desktop.evaluate(
        ({ BrowserWindow }, target) =>
          new Promise((resolve) => {
            target.once('closed', () =>
              resolve({
                destroyed: target.isDestroyed(),
                windowCount: BrowserWindow.getAllWindows().length,
              }),
            )
            target.close()
          }),
        window,
      ),
      remaining(),
      'NATIVE_MANAGER_NOT_CLOSED',
    )
    assert.deepEqual(closed, { destroyed: true, windowCount: 0 }, 'NATIVE_MANAGER_NOT_CLOSED')
  } finally {
    // Bounded test-handle cleanup must not replace the native-close failure.
    await withDeadline(window.dispose(), 1000, 'NATIVE_HANDLE_DISPOSE_TIMEOUT').catch(() => {})
  }
  const opened = desktop.waitForEvent('window', { timeout: remaining() })
  // Subscribe before triggering the second process/activation; consume both
  // rejections even if triggering fails, so no late unhandled rejection escapes.
  const [next] = await withDeadline(
    Promise.all([opened, Promise.resolve().then(() => trigger(remaining))]),
    remaining(),
    'MANAGER_REOPEN_TIMEOUT',
  )
  return next
}

function processEvidence(state) {
  if (!state) return null
  const child = state.child ?? state
  const code = state.exit?.code ?? child.exitCode
  const signal = state.exit?.signal ?? child.signalCode
  return {
    exited: Boolean(state.exit) || child.exitCode !== null || child.signalCode !== null,
    code: Number.isInteger(code) ? code : null,
    signal: typeof signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(signal) ? signal : null,
    spawnError: state.spawnError === true,
  }
}

export async function windowFailureEvidence(desktop, second, stage) {
  let native = null
  try {
    native = await withDeadline(
      desktop.evaluate(({ app, BrowserWindow }) => ({
        ready: app.isReady(),
        hasSingleInstanceLock: app.hasSingleInstanceLock(),
        windowCount: BrowserWindow.getAllWindows().length,
      })),
      1000,
      'WINDOW_EVIDENCE_UNAVAILABLE',
    )
  } catch {
    /* Unavailable inspection must not replace the original error. */
  }
  let primary = null, owned
  try {
    owned = desktop.process()
    primary = processEvidence(owned)
  } catch {
    /* The automation connection may already be disposed. */
  }
  return {
    stage: ['second-instance', 'activate'].includes(stage) ? stage : 'unknown',
    mainSample: native === null ? await sampleOwnedMain(owned) : { status: 'not-needed' },
    primary,
    second: processEvidence(second),
    // Never include raw output, URLs, paths, arguments or error messages.
    native:
      native &&
      typeof native.ready === 'boolean' &&
      typeof native.hasSingleInstanceLock === 'boolean' &&
      Number.isSafeInteger(native.windowCount) &&
      native.windowCount >= 0
        ? {
            ready: native.ready,
            hasSingleInstanceLock: native.hasSingleInstanceLock,
            windowCount: native.windowCount,
          }
        : null,
  }
}

export async function finishSecondInstance(second, failure, cleanup = stopOwned) {
  try {
    await cleanup(second)
  } catch (cleanupError) {
    throw Object.assign(
      new AggregateError(
        failure ? [failure, cleanupError] : [cleanupError],
        'SECOND_INSTANCE_EXIT_UNCONFIRMED',
      ),
      { preserveSmokeDirectory: true },
    )
  }
  if (failure) throw failure
}

export async function verifyManagerReopen(desktop, page, options) {
  let second, failure
  let stage = 'second-instance'
  try {
    const next = await reopenAfterNativeClose(desktop, page, async (remaining) => {
      second = spawnOwned(options.executable, [options.entry], options.env)
      const exit = await until(
        () => {
          assert(!second.spawnError, 'SECOND_INSTANCE_SPAWN_FAILED')
          return second.exit
        },
        remaining(),
        'SECOND_INSTANCE_EXIT_TIMEOUT',
      )
      assert.deepEqual(exit, { code: 0, signal: null }, 'SECOND_INSTANCE_EXIT_FAILED')
    })
    await next.waitForFunction(() => Boolean(window.contextweave), undefined, { timeout: 10000 })
    assert(
      (
        await withDeadline(
          next.evaluate(() => window.contextweave.app.getInfo()),
          5000,
          'REOPEN_INFO_TIMEOUT',
        )
      ).ok,
    )
    stage = 'activate'
    const active = await reopenAfterNativeClose(desktop, next, () =>
      desktop.evaluate(({ app }) => app.emit('activate')),
    )
    await active.waitForFunction(() => Boolean(window.contextweave), undefined, { timeout: 10000 })
    assert(
      (
        await withDeadline(
          active.evaluate(async () => window.contextweave.environment.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId })),
          5000,
          'ACTIVATE_LIST_TIMEOUT',
        )
      ).ok,
    )
  } catch (error) {
    failure = error
    console.error(
      JSON.stringify({ windowReopenFailure: await windowFailureEvidence(desktop, second, stage) }),
    )
  }
  await finishSecondInstance(second, failure)
  console.log(JSON.stringify({ destroyedWindowSecondInstance: 'passed', macActivate: 'passed' }))
}
