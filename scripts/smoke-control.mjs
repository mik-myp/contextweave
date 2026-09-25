// Main-only test driver: no Renderer hook, saved token, or authentication bypass.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const { WebSocket } = require('ws')

export async function connectManagedBrowser(desktop, environmentId, expectedPort) {
  const lease = await desktop.evaluateHandle(async ({ app }, environmentId) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const { join } = process.getBuiltinModule('node:path')
    const { application } = createRequire(join(app.getAppPath(), 'package.json'))(
      './dist-electron/main.js',
    )
    return application.acquireControlLease(environmentId)
  }, environmentId)
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
