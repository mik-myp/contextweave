import { classifyWindowSample, sampleOwnedMain } from './smoke-window-diagnostics.mjs'
import { writeFile, access } from 'node:fs/promises'
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


test('OS sample retains only fixed bounded categories, never native paths or arguments', () => {
  const secret = 'SENSITIVE_CANARY_MUST_NOT_ESCAPE'
  const input = `Path: /${secret}/BrowserWindow
Arguments: ${secret}
    + 17 uv__io_poll (in libuv) /${secret}/BrowserWindow
    + 4 mach_msg2_trap (in kernel)
` + '   + 1 V8InspectorSession\n'.repeat(300)
  const value = classifyWindowSample(input)
  assert.equal(value.status, 'sampled')
  assert.equal(value.frames.libuv, 1)
  assert.equal(value.frames.mach, 1)
  assert.equal(value.frames.nativeWindow, 0)
  assert.equal(value.frames.inspector, 255)
  assert(!JSON.stringify(value).includes(secret))
  assert.deepEqual(classifyWindowSample('x'.repeat(2*1024*1024+1)), {status:'unavailable'})
})
test('sampling owns only one bounded native command and removes its private raw fixture', async () => {
  const child = {pid:123,exitCode:null,signalCode:null}
  let file
  const value = await sampleOwnedMain(child,'darwin', async (command,args,options) => {
    assert.equal(command,'/usr/bin/sample')
    assert.deepEqual(args.slice(0,4),['123','1','10','-file'])
    assert.equal(options.timeout,3000)
    assert.equal(options.maxBuffer,65536)
    file=args[4]
    await writeFile(file,'  + 12 CFRunLoopRunSpecific\nPrivatePath: SENSITIVE\n')
  })
  assert.equal(value.frames.cocoaLoop,1)
  assert(!JSON.stringify(value).includes('SENSITIVE'))
  await assert.rejects(access(file),{code:'ENOENT'})
})
test('OS sample never runs for unsupported systems or no longer owned/live process handles',async()=>{
  for(const [child,platform] of [[{pid:123,exitCode:null,signalCode:null},'win32'],[{pid:123,exitCode:0,signalCode:null},'darwin'],[{pid:-1,exitCode:null,signalCode:null},'darwin'],[undefined,'darwin']])
    assert.notEqual((await sampleOwnedMain(child,platform,()=>assert.fail('must not spawn'))).status,'sampled')
})
test('exiting during sampling and sampler failures cannot produce trusted evidence',async()=>{
  const child={pid:123,exitCode:null,signalCode:null}
  const afterExit=await sampleOwnedMain(child,'darwin',async()=>{child.exitCode=0})
  assert.deepEqual(afterExit,{status:'unavailable'})
  const failure=await sampleOwnedMain({pid:123,exitCode:null,signalCode:null},'darwin',async()=>{throw new Error('SENSITIVE')})
  assert.deepEqual(failure,{status:'unavailable'})
})
