// Test-host diagnostics only. No app API, timeout extension, command replay or retry.
import { withDeadline, stopOwned } from './native-packaged-host.mjs'
import { sampleOwnedMain } from './smoke-window-diagnostics.mjs'

export async function stopFailedDesktop(app, stop = stopOwned) {
  const child = app.process()
  const exited = () => child.exitCode !== null || child.signalCode !== null
  const state = {
    child,
    exit: exited() ? { code: child.exitCode, signal: child.signalCode } : undefined,
    spawnError: false,
  }
  const onExit = (code, signal) => { state.exit = { code, signal } }
  child.once('exit', onExit)
  try {
    await stop(state)
    if (!state.exit) throw new Error('DESKTOP_EXIT_UNCONFIRMED')
  } finally {
    child.off('exit', onExit)
  }
}

export async function desktopStage(stage, action, {
  timeoutMs,
  app,
  log = value => console.log(JSON.stringify(value)),
  sample = sampleOwnedMain,
  stop = stopFailedDesktop,
}) {
  if (!/^[a-z0-9-]{1,80}$/.test(stage) || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('INVALID_DESKTOP_STAGE')
  const started = performance.now()
  log({ desktopStage: stage, state: 'started' })
  try {
    const result = await withDeadline(Promise.resolve().then(action), timeoutMs, 'DESKTOP_STAGE_TIMEOUT')
    log({ desktopStage: stage, state: 'passed', elapsedMs: Math.round(performance.now() - started) })
    return result
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error('DESKTOP_STAGE_FAILED', { cause })
    let mainSample = { status: 'not-available' }, cleanup = 'not-available'
    if (app) {
      try {
        mainSample = await withDeadline(sample(app.process()), 4000, 'DESKTOP_SAMPLE_TIMEOUT')
      } catch { /* No raw stack, process arguments, IPC result or error text is logged. */ }
      try {
        await stop(app)
        cleanup = 'owned-process-exited-after-failed-check'
      } catch {
        cleanup = 'exit-unconfirmed-retain-fixture'
        error.preserveSmokeDirectory = true
      }
    }
    log({ desktopStage: stage, state: 'failed',
      code: error?.message === 'DESKTOP_STAGE_TIMEOUT' ? 'DESKTOP_STAGE_TIMEOUT' : 'DESKTOP_STAGE_FAILED',
      elapsedMs: Math.round(performance.now() - started), mainSample, cleanup })
    // Forced cleanup is never a successful shutdown assertion, and never retries the action.
    throw error
  }
}
