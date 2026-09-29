import {
  installRuntimeDiagnostics,
  readRuntimeFailureEvidence,
  restoreRuntimeDiagnostics,
  summarizeFixtureCookie,
} from './smoke-runtime-diagnostics.mjs'
import { installKernelDiagnostics, readKernelDiagnostics, restoreKernelDiagnostics } from './smoke-kernel-diagnostics.mjs'

// Real official-package acceptance. No credentials or browser data are kept in the repository.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile, access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron } = require('playwright-core')
const appRoot = resolve(fileURLToPath(new URL('../apps/desktop/', import.meta.url)))
const customSource = process.argv.includes('--custom-source')
const reviewedProvider = process.argv.includes('--reviewed-provider')
assert(!(customSource && reviewedProvider), 'Custom mirrors are not admitted for the reviewed providers')
const suppliedProxy = process.env.CONTEXTWEAVE_SMOKE_PROXY
const suppliedData = process.env.CONTEXTWEAVE_SMOKE_DATA
const directory = suppliedData || (await mkdtemp(join(tmpdir(), 'cw-fingerprint-smoke-')))
const env = { ...process.env, CONTEXTWEAVE_USER_DATA: directory }
delete env.CONTEXTWEAVE_SMOKE_PROXY
delete env.CONTEXTWEAVE_SMOKE_DATA
const server = createServer((request, response) => {
  if (request.url === '/slow') {
    const timer = setTimeout(() => response.end('slow fixture complete'), 6500)
    response.once('close', () => clearTimeout(timer))
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<!doctype html><title>ContextWeave fingerprint fixture</title><h1>Persistent identity</h1>',
  )
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const fixtureUrl = `http://127.0.0.1:${server.address().port}`
const desktop = await _electron.launch({
  executablePath: require('electron'),
  args: [appRoot],
  env,
  timeout: 30000,
})
let id, liveId
const persistenceCheckpoints = []
try {
  await installKernelDiagnostics(desktop)
  await installRuntimeDiagnostics(desktop)
  const page = await desktop.firstWindow()
  await page.waitForFunction(() => !!window.contextweave?.kernel?.install)
  const kernels = await page.evaluate(async () => window.contextweave.kernel.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(kernels.ok)
  const catalog = await page.evaluate(async () => window.contextweave.kernel.catalog({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(catalog.ok)
  const reviewedId = process.platform === 'darwin' && process.arch === 'x64'
    ? 'fingerprint-chromium-pocchian-intel' : 'fingerprint-chromium-apostate'
  let provider = catalog.data.releases.find((item) => reviewedProvider
    ? item.provider === reviewedId
    : item.provider === 'fingerprint-chromium' && item.version === '148.0.7778.215')
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
    if (customSource) {
      const name =
        process.platform === 'win32'
          ? `ungoogled-chromium_${provider.version}-1.1_windows_x64.zip`
          : `ungoogled-chromium_${provider.version}-1.1_macos.dmg`
      const prepared = await page.evaluate(
        async (input) => window.contextweave.kernel.prepareCustom({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, input),
        {
          providerId: provider.provider,
          url: `https://github.com/adryfish/fingerprint-chromium/releases/download/${provider.version}/${name}?download=1`,
          version: provider.version,
          sha256: provider.sha256,
          trustedSource: true,
        },
      )
      assert(prepared.ok, JSON.stringify(prepared))
      assert.equal(prepared.data.sourceType, 'custom')
      provider = prepared.data
    }
    console.log(
      JSON.stringify({
        stage: customSource ? 'custom-package-install' : 'official-package-install',
        provider: provider.provider, version: provider.version,
        osVersion: (await import('node:os')).release(),
        platform: process.platform,
        arch: process.arch,
      }),
    )
    const installed = await page.evaluate(
      async (id) => window.contextweave.kernel.install({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id),
      provider.id,
    )
    assert(installed.ok, JSON.stringify(installed))
    assert.equal(installed.data.status, 'available')
    // Proxy/WebRTC capability remains unverified for the reviewed fork. Keep
    // this lifecycle smoke offline and exercise authenticated proxy transport
    // separately, so a fork-specific Fetch auth implementation cannot be
    // mistaken for a provider install or persistence failure.
    const created = await page.evaluate(
      async (kernelId) =>
        window.contextweave.environment.create({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
          name: 'Fingerprint acceptance',
          kernelId,
          commonConfig: { language: 'en-US', timezone: 'Europe/London' },
        }),
      provider.id,
    )
    assert(created.ok, JSON.stringify(created))
    id = created.data.id
    const detail = await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert(detail.ok && detail.data.fingerprint?.seed)
    const observations = []
    for (let run = 0; run < 2; run++) {
      const started = await page.evaluate(async (id) => window.contextweave.environment.start({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
      assert(started.ok, JSON.stringify(started))
      const deadline = Date.now() + 15000
      let running
      do {
        running = await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
        if (running.ok && running.data.status === 'running') break
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      assert(running.ok && running.data.status === 'running', 'Reviewed provider must reach running state')
      observations.push({ fingerprint: running.data.fingerprint })
      const auditedLaunchArguments = await desktop.evaluate(
        () => globalThis.__cwRuntimeDiagnostics?.records.flatMap((record) => record.auditedLaunchArguments ?? []) ?? [],
      )
      assert(!auditedLaunchArguments.includes('--host-resolver-rules'), 'Do not pass the unsupported resolver flag')
      assert(!auditedLaunchArguments.includes('--test-type'), 'Do not hide security warnings with test mode')
      const stopped = await page.evaluate(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
      assert(stopped.ok, JSON.stringify(stopped))
      persistenceCheckpoints.push({ run, stage: 'after-stop', status: stopped.data.status })
    }
    assert.deepEqual(observations[0], observations[1], 'Provider identity must remain stable after restart')
    const prior = await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)
    assert((await page.evaluate(async (id) => window.contextweave.kernel.remove({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), provider.id)).ok)
    assert.deepEqual(
      (await page.evaluate(async (id) => window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)).data,
      prior.data,
    )
    await access(join(directory, 'contextweave', 'environments', id, 'Default'))
    const unavailable = await page.evaluate(
      async (id) => window.contextweave.environment.preflight({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id),
      id,
    )
    assert(
      unavailable.ok &&
        !unavailable.data.canStart &&
        unavailable.data.issues.some((item) => item.code === 'KERNEL_UNAVAILABLE'),
    )
    const reinstalled = await page.evaluate(
      async (id) => window.contextweave.kernel.install({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id),
      provider.id,
    )
    assert(reinstalled.ok && reinstalled.data.status === 'available', JSON.stringify(reinstalled))
    assert((await page.evaluate(async (id) => window.contextweave.environment.start({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)).ok)
    assert((await page.evaluate(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), id)).ok)
    console.log(
      JSON.stringify({
        ...(customSource ? { customInstall: 'passed' } : { officialInstall: 'passed' }),
        fingerprintLifecycle: 'passed',
        identityStable: true,
        dataRetained: 'profile-retained',
        authenticatedProxy: 'unverified-for-reviewed-fork',
        slowResponseAndClosingRequests: 'covered-by-desktop-smoke',
        kernelDeleteReinstallPreservesProfile: 'passed',
        restoredTabs: 'covered-by-desktop-smoke',
        environmentStop: 'passed',
        launchArgumentsAudited: 'passed',
        trashRestore: 'passed',
        kernelVersion: installed.data.version,
        platform: process.platform,
        arch: process.arch,
      }),
    )
  }
} catch (error) {
  console.error(JSON.stringify({
    persistenceCheckpoints,
    runtimeEvidence: await readRuntimeFailureEvidence(desktop).catch(() => ({ unavailable: true })),
  }))
  console.error(JSON.stringify({ kernelInstallEvidence: await readKernelDiagnostics(desktop).catch(() => ['unavailable']) }))
  throw error
} finally {
  await restoreRuntimeDiagnostics(desktop)
  await restoreKernelDiagnostics(desktop)
  const page = await desktop.firstWindow().catch(() => undefined)
  for (const envId of [id, liveId].filter(Boolean))
    await page?.evaluate(async (id) => window.contextweave.environment.stop({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), envId).catch(() => {})
  await desktop.close()
  await new Promise((resolve) => server.close(resolve))
  if (!suppliedData)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
