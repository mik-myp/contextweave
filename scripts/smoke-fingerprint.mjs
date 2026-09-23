// Real official-package acceptance. No credentials or browser data are kept in the repository.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron, chromium } = require('playwright-core')
const { Server } = require('proxy-chain')
const appRoot = resolve(fileURLToPath(new URL('../apps/desktop/', import.meta.url)))
const suppliedProxy = process.env.CONTEXTWEAVE_SMOKE_PROXY
const suppliedData = process.env.CONTEXTWEAVE_SMOKE_DATA
const directory = suppliedData || (await mkdtemp(join(tmpdir(), 'cw-fingerprint-smoke-')))
const env = { ...process.env, CONTEXTWEAVE_USER_DATA: directory }
delete env.CONTEXTWEAVE_SMOKE_PROXY
delete env.CONTEXTWEAVE_SMOKE_DATA
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<!doctype html><title>ContextWeave fingerprint fixture</title><h1>Persistent identity</h1>',
  )
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const fixtureUrl = `http://127.0.0.1:${server.address().port}`
let forwarded = 0
const upstream = new Server({
  host: '127.0.0.1',
  port: 0,
  verbose: false,
  prepareRequestFunction: ({ username, password }) => {
    if (username === 'fixture-user' && password === 'fixture-password') forwarded++
    return { requestAuthentication: username !== 'fixture-user' || password !== 'fixture-password' }
  },
})
upstream.on('requestFailed', () => {})
await upstream.listen()
const desktop = await _electron.launch({
  executablePath: require('electron'),
  args: [appRoot],
  env,
  timeout: 30000,
})
let id, liveId
try {
  const page = await desktop.firstWindow()
  await page.waitForFunction(() => !!window.contextweave?.kernel?.install)
  const kernels = await page.evaluate(() => window.contextweave.kernel.list())
  assert(kernels.ok)
  const catalog = await page.evaluate(() => window.contextweave.kernel.catalog())
  assert(catalog.ok)
  const provider = catalog.data.releases.find((item) => item.version === '148.0.7778.215')
  if (!provider?.installable) {
    assert(
      !process.argv.includes('--require-provider'),
      'This architecture has no qualified upstream asset',
    )
    console.log(
      JSON.stringify({
        fingerprintLifecycle: 'unsupported-platform',
        platform: process.platform,
        arch: process.arch,
      }),
    )
  } else {
    console.log(
      JSON.stringify({
        stage: 'official-package-install',
        platform: process.platform,
        arch: process.arch,
      }),
    )
    const installed = await page.evaluate(
      (id) => window.contextweave.kernel.install(id),
      provider.id,
    )
    assert(installed.ok, JSON.stringify(installed))
    assert.equal(installed.data.status, 'available')
    const proxy = await page.evaluate(
      (port) =>
        window.contextweave.proxy.save({
          config: {
            name: 'Isolated acceptance proxy',
            type: 'http',
            host: '127.0.0.1',
            port,
            username: 'fixture-user',
          },
          password: 'fixture-password',
        }),
      upstream.port,
    )
    assert(proxy.ok, JSON.stringify(proxy))
    const created = await page.evaluate(
      ({ proxyId, kernelId }) =>
        window.contextweave.environment.create({
          name: 'Fingerprint acceptance',
          kernelId,
          proxyId,
          commonConfig: { language: 'en-US', timezone: 'Europe/London' },
        }),
      { proxyId: proxy.data.proxyId, kernelId: provider.id },
    )
    assert(created.ok, JSON.stringify(created))
    id = created.data.id
    const detail = await page.evaluate((id) => window.contextweave.environment.get(id), id)
    assert(detail.ok && detail.data.fingerprint?.seed)
    const observations = []
    for (let run = 0; run < 2; run++) {
      const started = await page.evaluate((id) => window.contextweave.environment.start(id), id)
      assert(started.ok, JSON.stringify(started))
      const lock = JSON.parse(
        await readFile(
          join(directory, 'contextweave', 'environments', id, '.runtime.lock', 'owner.json'),
          'utf8',
        ),
      )
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${lock.controlPort}`)
      const context = browser.contexts()[0]
      const tab = await context.newPage()
      await tab.goto(fixtureUrl)
      const observation = await tab.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 280
        canvas.height = 90
        const ctx = canvas.getContext('2d')
        ctx.font = '18px Arial'
        ctx.fillStyle = '#1873dc'
        ctx.fillText('ContextWeave fingerprint acceptance', 5, 25)
        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          cores: navigator.hardwareConcurrency,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          canvas: canvas.toDataURL(),
          retained: localStorage.getItem('cw-acceptance'),
        }
      })
      observations.push(observation)
      assert.equal(observation.cores, 8)
      assert.equal(observation.language, 'en-US')
      assert.equal(observation.timezone, 'Europe/London')
      if (run) assert.equal(observation.retained, 'retained')
      await tab.evaluate(() => {
        localStorage.setItem('cw-acceptance', 'retained')
        document.cookie = 'cw-cookie=retained;max-age=3600;path=/'
      })
      assert((await context.cookies()).some((cookie) => cookie.name === 'cw-cookie'))
      assert((await page.evaluate((id) => window.contextweave.environment.stop(id), id)).ok)
    }
    const identity = ({ retained: _retained, ...value }) => value
    assert.deepEqual(
      identity(observations[0]),
      identity(observations[1]),
      'Identity must remain stable after stopping and reopening',
    )
    assert(forwarded > 0, 'Browser requests must traverse the authenticated upstream')
    assert((await page.evaluate((id) => window.contextweave.environment.delete(id), id)).ok)
    assert((await page.evaluate((id) => window.contextweave.environment.restore(id), id)).ok)
    const restored = await page.evaluate((id) => window.contextweave.environment.get(id), id)
    assert.deepEqual(restored.data.fingerprint, detail.data.fingerprint)
    if (suppliedProxy) {
      const endpoint = new URL(suppliedProxy)
      const config = {
        name: 'Temporary network acceptance',
        type: endpoint.protocol.slice(0, -1),
        host: endpoint.hostname,
        port: Number(endpoint.port),
        username: decodeURIComponent(endpoint.username),
      }
      const input = { config, password: decodeURIComponent(endpoint.password) }
      const checked = await page.evaluate((input) => window.contextweave.proxy.test(input), input)
      assert(checked.ok && checked.data.success, 'Supplied proxy HTTPS connection test failed')
      const saved = await page.evaluate((input) => window.contextweave.proxy.save(input), input)
      assert(saved.ok, 'Temporary proxy could not be saved securely')
      const live = await page.evaluate(
        ({ proxyId, kernelId }) =>
          window.contextweave.environment.create({
            name: 'Temporary proxy browser acceptance',
            kernelId,
            proxyId,
            commonConfig: { language: 'en-US', timezone: 'system' },
          }),
        { proxyId: saved.data.proxyId, kernelId: provider.id },
      )
      assert(live.ok)
      liveId = live.data.id
      const started = await page.evaluate((id) => window.contextweave.environment.start(id), liveId)
      assert(started.ok, JSON.stringify(started))
      const lock = JSON.parse(
        await readFile(
          join(directory, 'contextweave', 'environments', liveId, '.runtime.lock', 'owner.json'),
          'utf8',
        ),
      )
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${lock.controlPort}`)
      const tab = await browser.contexts()[0].newPage()
      await tab.goto('https://api.ipify.org?format=json', { timeout: 45000 })
      const result = JSON.parse(await tab.locator('body').innerText())
      assert.equal(
        result.ip,
        checked.data.exitIp,
        'Proxy tester and browser must use the same exit',
      )
      assert((await page.evaluate((id) => window.contextweave.environment.stop(id), liveId)).ok)
      console.log(JSON.stringify({ suppliedProxy: 'passed', https: 'passed', sameExit: true }))
    }
    console.log(
      JSON.stringify({
        officialInstall: 'passed',
        fingerprintLifecycle: 'passed',
        identityStable: true,
        dataRetained: true,
        authenticatedProxy: 'passed',
        trashRestore: 'passed',
        kernelVersion: installed.data.version,
        platform: process.platform,
        arch: process.arch,
      }),
    )
  }
} finally {
  const page = await desktop.firstWindow().catch(() => undefined)
  for (const envId of [id, liveId].filter(Boolean))
    await page?.evaluate((id) => window.contextweave.environment.stop(id), envId).catch(() => {})
  await desktop.close()
  await upstream.close(true)
  await new Promise((resolve) => server.close(resolve))
  if (!suppliedData)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
