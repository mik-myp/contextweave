import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import {
  finishSecondInstance,
  reopenAfterNativeClose,
  windowFailureEvidence,
} from './smoke-window-lifecycle.mjs'

function nativeWindowFixture() {
  const order = []
  const window = new EventEmitter()
  let destroyed = false
  let windows = [window]
  let announce
  window.isDestroyed = () => destroyed
  window.close = () => {
    order.push('native-close')
    window.emit('close')
    setImmediate(() => {
      destroyed = true
      windows = []
      order.push('native-closed')
      window.emit('closed')
    })
  }
  window.dispose = async () => { order.push('disposed') }
  const page = { close: () => { throw new Error('RENDERER_CLOSE_IS_NOT_NATIVE_CLOSE') } }
  const desktop = {
    browserWindow: async (target) => {
      assert.equal(target, page)
      order.push('native-handle')
      return window
    },
    evaluate: (read, handle) => read({ BrowserWindow: { getAllWindows: () => windows } }, handle),
    waitForEvent(name, options) {
      assert.equal(name, 'window')
      assert(options.timeout <= 1000)
      order.push('subscribed')
      return new Promise((resolve) => { announce = resolve })
    },
  }
  return { desktop, page, window, order, announce: (next) => announce(next) }
}

test('second-instance closes the corresponding native window and waits for closed, not a renderer target', async () => {
  const f = nativeWindowFixture()
  const opened = { fixture: true }
  const result = await reopenAfterNativeClose(f.desktop, f.page, () => {
    assert(f.window.isDestroyed())
    f.order.push('triggered')
    f.announce(opened)
  }, 1000)
  assert.equal(result, opened)
  assert.deepEqual(f.order, ['native-handle', 'native-close', 'native-closed', 'disposed', 'subscribed', 'triggered'])
  assert.equal(f.window.listenerCount('closed'), 0)
})

for (const blocked of ['native-close', 'main-inspection', 'native-lookup'])
  test(`no second instance launches when ${blocked} is unconfirmed`, async () => {
    const f = nativeWindowFixture()
    if (blocked === 'native-close') f.window.close = () => {}
    if (blocked === 'main-inspection') f.desktop.evaluate = () => new Promise(() => {})
    if (blocked === 'native-lookup') f.desktop.browserWindow = () => new Promise(() => {})
    let triggered = false
    await assert.rejects(
      reopenAfterNativeClose(f.desktop, f.page, () => { triggered = true }, 20),
      blocked === 'native-lookup' ? /MANAGER_NATIVE_WINDOW_UNAVAILABLE/ : /NATIVE_MANAGER_NOT_CLOSED/,
    )
    assert.equal(triggered, false)
    if (blocked !== 'native-lookup') assert(f.order.includes('disposed'))
  })

test('native receipt rejects an undestroyed target or another remaining native window', async () => {
  for (const receipt of [{ destroyed: false, windowCount: 0 }, { destroyed: true, windowCount: 1 }]) {
    const f = nativeWindowFixture()
    f.desktop.evaluate = async () => receipt
    await assert.rejects(
      reopenAfterNativeClose(f.desktop, f.page, () => assert.fail('Must not trigger a replacement'), 1000),
      /NATIVE_MANAGER_NOT_CLOSED/,
    )
    assert(f.order.includes('disposed'))
  }
})

test('trigger failure is preserved and late window rejection is consumed', async () => {
  const failure = new Error('TRIGGER_FAILURE')
  const f = nativeWindowFixture()
  f.desktop.waitForEvent = () => new Promise((_, reject) => setTimeout(() => reject(new Error('LATE')), 10))
  await assert.rejects(
    reopenAfterNativeClose(f.desktop, f.page, () => { throw failure }, 1000),
    (actual) => actual === failure,
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
})

test('window evidence stays bounded and excludes raw process output, arguments and injected fields', async () => {
  const desktop = {
    process: () => ({ exitCode: null, signalCode: null, args: ['password=secret'] }),
    evaluate: async () => ({
      ready: true,
      hasSingleInstanceLock: true,
      windowCount: 0,
      url: 'secret',
    }),
  }
  const second = {
    child: { exitCode: 1, signalCode: null },
    stderr: 'secret',
    stdout: 'password',
    exit: { code: 1, signal: null },
  }
  const evidence = await windowFailureEvidence(desktop, second, 'second-instance')
  assert.deepEqual(evidence.native, { ready: true, hasSingleInstanceLock: true, windowCount: 0 })
  assert.equal(evidence.primary.exited, false)
  assert.equal(evidence.second.code, 1)
  assert(!JSON.stringify(evidence).match(/secret|password|stderr|args|url/))
  desktop.evaluate = async () => {
    throw new Error('secret')
  }
  assert.equal((await windowFailureEvidence(desktop, second, 'secret')).native, null)
  assert.equal((await windowFailureEvidence(desktop, second, 'secret')).stage, 'unknown')
})

test('unconfirmed helper exit preserves the original failure and its data directory', async () => {
  const primary = new Error('PRIMARY'),
    cleanup = new Error('CLEANUP')
  await assert.rejects(
    finishSecondInstance({}, primary, async () => {
      throw cleanup
    }),
    (error) => {
      assert(error instanceof AggregateError)
      assert.deepEqual(error.errors, [primary, cleanup])
      assert.equal(error.preserveSmokeDirectory, true)
      return true
    },
  )
  await assert.rejects(
    finishSecondInstance({}, primary, async () => {}),
    (actual) => actual === primary,
  )
})
