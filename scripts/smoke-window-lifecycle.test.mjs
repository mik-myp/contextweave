import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  finishSecondInstance,
  reopenAfterNativeClose,
  windowFailureEvidence,
} from './smoke-window-lifecycle.mjs'

test('second-instance waits for native destruction, not merely the renderer close event', async () => {
  const order = []
  let inspections = 0,
    announce
  const native = { BrowserWindow: { getAllWindows: () => (++inspections === 1 ? [{}] : []) } }
  const desktop = {
    evaluate: (read) => read(native),
    waitForEvent(name, options) {
      assert.equal(name, 'window')
      assert(options.timeout <= 1000)
      order.push('subscribed')
      return new Promise((resolve) => {
        announce = resolve
      })
    },
  }
  const page = {
    close: async () => {
      order.push('page-close')
    },
  }
  const opened = { fixture: true }
  const result = await reopenAfterNativeClose(
    desktop,
    page,
    () => {
      assert.equal(inspections, 2)
      order.push('triggered')
      announce(opened)
    },
    1000,
  )
  assert.equal(result, opened)
  assert.deepEqual(order, ['page-close', 'subscribed', 'triggered'])
})

test('no second instance launches when the native window or Main inspection never closes', async () => {
  for (const evaluate of [async () => false, () => new Promise(() => {})]) {
    let triggered = false
    await assert.rejects(
      reopenAfterNativeClose(
        { evaluate },
        { close: async () => {} },
        () => {
          triggered = true
        },
        20,
      ),
      /NATIVE_MANAGER_NOT_CLOSED/,
    )
    assert.equal(triggered, false)
  }
})

test('trigger failure is preserved and late window rejection is consumed', async () => {
  const failure = new Error('TRIGGER_FAILURE')
  const desktop = {
    evaluate: async () => true,
    waitForEvent: () => new Promise((_, reject) => setTimeout(() => reject(new Error('LATE')), 10)),
  }
  await assert.rejects(
    reopenAfterNativeClose(
      desktop,
      { close: async () => {} },
      () => {
        throw failure
      },
      1000,
    ),
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
