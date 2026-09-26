// Main-only test driver: no Renderer hook, saved token, or authentication bypass.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const { WebSocket } = require('ws')

async function acquireManagedControl(desktop, environmentId) {
  return desktop.evaluateHandle(async ({ app }, environmentId) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const { join } = process.getBuiltinModule('node:path')
    const { application } = createRequire(join(app.getAppPath(), 'package.json'))(
      './dist-electron/main.js',
    )
    return application.acquireControlLease(environmentId)
  }, environmentId)
}

export async function connectManagedBrowser(desktop, environmentId, expectedPort) {
  const lease = await acquireManagedControl(desktop, environmentId)
  const access = await lease.evaluate((value) => value.access)
  if (expectedPort !== undefined) assert.equal(access.port, expectedPort)
  const url = `ws://127.0.0.1:${access.port}/contextweave/browser`
  // Validate the negative path against the exact service inside the running app/package.
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 2000 })
    socket.on('error', () => resolve())
    socket.on('open', () => {
      socket.terminate()
      reject(new Error('Unauthenticated control accepted'))
    })
    socket.on('unexpected-response', (_, response) => {
      response.resume()
      socket.terminate()
      resolve()
    })
  })
  try {
    const response = await fetch(`http://127.0.0.1:${access.port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    })
    assert.equal(response.status, 404, 'Native CDP discovery must not be available')
    const browser = await chromium.connectOverCDP(url, {
      headers: { Authorization: `Bearer ${access.token}` },
      timeout: 15000,
    })
    browser.once('disconnected', () => {
      void lease
        .evaluate((value) => value.revoke())
        .catch(() => {})
        .finally(() => lease.dispose().catch(() => {}))
    })
    return browser
  } catch {
    await lease.evaluate((value) => value.revoke()).catch(() => {})
    await lease.dispose().catch(() => {})
    // Playwright connection errors may include Authorization headers; don't emit them.
    throw new Error('Authenticated fixture browser connection failed')
  }
}

// Deliberately deliver one command after an actual native target detach. A renderer/IPC
// queue can do this during navigation; rejecting it must not disconnect healthy sessions.
export async function verifyDetachedControlSession(desktop, environmentId, browser) {
  const lease = await acquireManagedControl(desktop, environmentId)
  const access = await lease.evaluate((value) => value.access)
  const socket = new WebSocket(`ws://127.0.0.1:${access.port}/contextweave/browser`, {
    headers: { Authorization: `Bearer ${access.token}` },
    handshakeTimeout: 5000,
    maxPayload: 65536,
    perMessageDeflate: false,
  })
  const pending = new Map()
  const detached = new Set()
  let sequence = 0
  let targetId
  const rejectPending = () => {
    for (const command of pending.values()) {
      clearTimeout(command.timer)
      command.reject(
        new Error('Detached-session regression: control connection closed before replying'),
      )
    }
    pending.clear()
  }
  socket.on('error', rejectPending)
  socket.on('close', rejectPending)
  socket.on('message', (data) => {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return socket.terminate()
    }
    if (
      message.method === 'Target.detachedFromTarget' &&
      typeof message.params?.sessionId === 'string'
    )
      detached.add(message.params.sessionId)
    const command = pending.get(message.id)
    if (!command) return
    pending.delete(message.id)
    clearTimeout(command.timer)
    command.resolve(message)
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN)
        return reject(new Error('Detached-session regression: connection is not open'))
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Detached-session regression: command timed out'))
      }, 5000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params, sessionId }), (error) => {
        if (error) rejectPending()
      })
    })
  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', () =>
        reject(new Error('Detached-session regression: connection failed')),
      )
      socket.once('close', () =>
        reject(new Error('Detached-session regression: connection closed')),
      )
    })
    const created = await send('Target.createTarget', { url: 'about:blank', background: true })
    assert.equal(created.error, undefined, 'Native target creation must succeed')
    targetId = created.result?.targetId
    assert.equal(typeof targetId, 'string')
    const attached = await send('Target.attachToTarget', { targetId, flatten: true })
    assert.equal(attached.error, undefined, 'Native target attachment must succeed')
    const sessionId = attached.result?.sessionId
    assert.equal(typeof sessionId, 'string')
    const closed = await send('Target.closeTarget', { targetId })
    assert.equal(closed.result?.success, true)
    targetId = undefined
    const deadline = performance.now() + 5000
    while (!detached.has(sessionId) && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert(detached.has(sessionId), 'An actual native detach event must precede the late command')
    const stale = await send('Runtime.evaluate', { expression: '1' }, sessionId)
    assert.equal(
      stale.error?.code,
      -32001,
      'Late commands must receive a session error, not disconnect',
    )
    assert.equal(stale.error?.message, 'Session with given id not found.')
    const version = await send('Browser.getVersion')
    assert.equal(version.error, undefined)
    assert.equal(typeof version.result?.product, 'string')
    assert(browser.isConnected(), 'An independent client must remain connected')
    console.log(
      JSON.stringify({
        detachedSessionRegression: 'passed-native-target-close-late-command-and-next-command',
      }),
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        detachedSessionRegression: 'failed',
        peerConnected: browser.isConnected(),
        socketState: socket.readyState,
      }),
    )
    throw error
  } finally {
    socket.terminate()
    rejectPending()
    await lease.evaluate((value) => value.revoke()).catch(() => {})
    await lease.dispose().catch(() => {})
    if (targetId && browser.isConnected()) {
      const cleanup = await browser.newBrowserCDPSession()
      try {
        await cleanup.send('Target.closeTarget', { targetId })
      } finally {
        await cleanup.detach()
      }
    }
  }
}
