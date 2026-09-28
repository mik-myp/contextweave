// Explicit local browser acceptance. No downloads, personal profiles or external websites.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { executable: { type: 'string' } } })
if (!values.executable) throw new Error('Provide --executable with an approved local Chromium path')
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild')
const { WebSocket } = require('ws')
const root = await mkdtemp(join(tmpdir(), 'cw-runtime-stability-'))
const bundle = join(root, 'runtime.cjs')
buildSync({
  stdin: {
    contents: `
    export { createBrowserControl } from './apps/desktop/electron/services/browser-control';
    export { browserControlUrl } from './apps/desktop/electron/services/browser-control-access';
    export { openProxyTransport } from './apps/desktop/electron/services/proxy-transport';
    export { connectBrowserSettings, prepareBrowserProfile } from './apps/desktop/electron/browser-settings';
    export { restoreBrowserWindows } from './apps/desktop/electron/services/browser-window-restore';
  `,
    resolveDir: resolve('.'),
  },
  bundle: true,
  keepNames: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'silent',
})
const runtime = require(bundle)
let browserVersion
let pageRequests = 0
let assetRequests = 0
const site = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.url.startsWith('/asset')) {
    assetRequests++
    res.end('ok')
    return
  }
  pageRequests++
  res.setHeader('Content-Type', 'text/html')
  res.end(`<!doctype html><title>Local runtime fixture</title><script>
    window.fixtureDone = false;
    window.initialTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    Promise.all(Array.from({length: 100}, (_, i) => fetch('/asset?i='+i, {cache: 'no-store'}))).then(() => {
      localStorage.setItem('restored', 'yes'); window.fixtureDone = true;
    });
  </script>`)
})
site.listen(0, '127.0.0.1')
await once(site, 'listening')
const url = `http://127.0.0.1:${site.address().port}`
// An upstream fixture which refuses all external destinations, including CONNECT.
const upstream = createServer((req, res) => {
  if (
    req.headers['proxy-authorization'] !==
    'Basic ' + Buffer.from('fixture-user:fixture-password').toString('base64')
  ) {
    res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="fixture"' }).end()
    return
  }
  let target
  try {
    target = new URL(req.url)
  } catch {
    res.writeHead(400).end()
    return
  }
  if (target.origin !== url) {
    res.writeHead(403).end()
    return
  }
  const headers = { ...req.headers }
  delete headers['proxy-authorization']
  const forward = request(target, { method: req.method, headers }, (response) => {
    res.writeHead(response.statusCode, response.headers)
    response.pipe(res)
  })
  forward.on('error', () => res.writeHead(502).end())
  req.pipe(forward)
})
upstream.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'))
upstream.listen(0, '127.0.0.1')
await once(upstream, 'listening')
const failures = []
let child, control, transport, closeSettings, observer
async function connectObserver() {
  const lease = control.lease()
  const socket = new WebSocket(runtime.browserControlUrl(lease.access), {
    headers: { Authorization: `Bearer ${lease.access.token}` },
  })
  const pending = new Map()
  let sequence = 0
  socket.on('message', (text) => {
    const message = JSON.parse(text.toString())
    if (!message.id) return
    const command = pending.get(message.id)
    if (!command) return
    pending.delete(message.id)
    clearTimeout(command.timer)
    if (message.error) command.reject(new Error('Fixture observer command rejected'))
    else command.resolve(message.result)
  })
  socket.on('close', () => {
    for (const command of pending.values()) {
      clearTimeout(command.timer)
      command.reject(new Error('Fixture observer closed'))
    }
    pending.clear()
  })
  await once(socket, 'open', { signal: AbortSignal.timeout(10000) })
  return {
    close: () => {
      socket.close()
      lease.revoke()
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Fixture observer timed out: ${method}`))
        }, 10000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params, sessionId }))
      })
    },
  }
}
async function checkPage(targetId) {
  await observer.send('Target.activateTarget', { targetId })
  const { sessionId } = await observer.send('Target.attachToTarget', { targetId, flatten: true })
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await observer.send(
        'Runtime.evaluate',
        {
          expression:
            '({done: window.fixtureDone, timezone: window.initialTimezone, currentTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, persisted: localStorage.getItem("restored")})',
          returnByValue: true,
        },
        sessionId,
      )
      const value = response.result?.value
      if (value?.done) {
        assert.equal(value.timezone, 'UTC')
        assert.equal(value.currentTimezone, 'UTC')
        assert.equal(value.persisted, 'yes')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Fixture page did not finish its request burst')
  } finally {
    await observer.send('Target.detachFromTarget', { sessionId })
  }
}
async function launch() {
  transport = await runtime.openProxyTransport(
    { type: 'http', host: '127.0.0.1', port: upstream.address().port, username: 'fixture-user' },
    'fixture-password',
  )
  control = await runtime.createBrowserControl()
  const plan = {
    executablePath: resolve(values.executable),
    userDataDir: join(root, 'profile'),
    controlTransport: 'pipe',
    args: [
      `--user-data-dir=${join(root, 'profile')}`,
      '--remote-debugging-pipe',
      '--restore-last-session',
      '--disable-background-mode',
      '--no-first-run',
      '--no-default-browser-check',
      ...transport.args,
    ],
  }
  runtime.prepareBrowserProfile(plan.userDataDir, 'en-US', true)
  child = spawn(plan.executablePath, [...plan.args, '--no-startup-window'], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  })
  control.attach(child)
  const signal = AbortSignal.timeout(30000)
  browserVersion = await control.ready(signal)
  const lease = control.lease()
  closeSettings = await runtime.connectBrowserSettings(
    lease.access,
    { language: 'en-US', timezone: 'UTC', window: { width: 1200, height: 800 } },
    (error) => failures.push(error.code ?? 'settings-failure'),
    transport.authentication,
    () => failures.push('unexpected-empty-pages'),
  )
  const previousRequests = pageRequests
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(pageRequests, previousRequests, 'No page may load before authentication is ready')
  await runtime.restoreBrowserWindows(plan, signal)
  observer = await connectObserver()
}
async function shutdown() {
  observer?.close()
  observer = undefined
  closeSettings?.()
  closeSettings = undefined
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    try {
      await control.closeBrowser()
    } catch {
      child.kill('SIGTERM')
    }
    let timer
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 3000)
      }),
    ])
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) await exited
  }
  control?.close()
  await transport?.close()
}
try {
  await launch()
  const startupUrls = Array.from({ length: 4 }, (_, index) => `${url}/page-${index}`)
  await control.openStartupBookmarks([...startupUrls, startupUrls[0]], AbortSignal.timeout(15000), performance.now() + 15000)
  const { targetInfos: initialTargets } = await observer.send('Target.getTargets')
  const pages = initialTargets.filter(target => target.type === 'page' && target.url.startsWith(url))
  assert.equal(pages.length, 4, 'Startup bookmarks are opened once without duplicate URLs')
  await Promise.all(pages.map(({ targetId }) => checkPage(targetId)))
  assert.ok(assetRequests >= 400)
  assert.deepEqual(failures, [])
  await shutdown()
  const assetsBeforeRestore = assetRequests
  await launch()
  let restored = []
  for (let attempt = 0; attempt < 100; attempt++) {
    const { targetInfos } = await observer.send('Target.getTargets')
    restored = targetInfos.filter((target) => target.type === 'page' && target.url.startsWith(url))
    if (restored.length === 4) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(restored.length, 4, 'All prior fixture tabs must be restored')
  for (const page of restored) await checkPage(page.targetId)
  await control.openStartupBookmarks(startupUrls, AbortSignal.timeout(15000), performance.now() + 15000)
  const { targetInfos: afterStartup } = await observer.send('Target.getTargets')
  assert.equal(afterStartup.filter(target => target.type === 'page' && target.url.startsWith(url)).length, 4, 'Restored startup bookmarks are reused')
  assert.ok(assetRequests >= assetsBeforeRestore + 400)
  await observer.send('Target.closeTarget', { targetId: restored[0].targetId })
  const replacement = await observer.send('Target.createTarget', { url: `${url}/replacement` })
  await checkPage(replacement.targetId)
  for (const page of restored.slice(1)) await checkPage(page.targetId)
  assert.deepEqual(failures, [])
  assert.equal(child.exitCode, null)
  console.log(
    JSON.stringify({
      success: true,
      browserVersion,
      restoredTabs: restored.length,
      assetRequests,
      settingsFailures: failures.length,
      scope:
        'local Chromium; authenticated proxy; fresh and restored profile; startup bookmarks with deduplication; four concurrent tabs and tab replacement',
    }),
  )
} catch (error) {
  console.error({ pageRequests, assetRequests, failures })
  throw error
} finally {
  await shutdown()
  upstream.closeAllConnections()
  upstream.close()
  site.closeAllConnections()
  site.close()
  await rm(root, { recursive: true, force: true })
}
