// Explicit local executable only. Disposable profile, private CDP pipe, no external fixture sites.
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const executable = process.argv[process.argv.indexOf('--executable') + 1]
if (!process.argv.includes('--executable') || !executable) throw Error('Pass --executable with an explicitly selected Chromium binary')
const root = await mkdtemp(join(tmpdir(), 'cw-probe-verification-'))
try {
  const entry = join(root, 'probe.cjs')
  await createRequire(require.resolve('vite/package.json'))('esbuild').build({ entryPoints: [fileURLToPath(new URL('../apps/desktop/electron/services/kernel-capability-probe.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', outfile: entry, logLevel: 'silent' })
  const { probeKernelCapabilities } = require(entry)
  const capabilities = Object.fromEntries(['cdp', 'screenshot', 'elementScreenshot', 'fileUpload', 'userAgent', 'timezone', 'proxy', 'webRtcPolicy'].map((key) => [key, true]))
  const result = await probeKernelCapabilities(resolve(executable), capabilities, AbortSignal.timeout(30000))
  for (const key of ['cdp', 'screenshot', 'elementScreenshot', 'fileUpload', 'userAgent', 'timezone']) {
    assert.equal(result.report[key].state, 'verified', key)
    assert(result.report[key].version && result.report[key].checkedAt && result.report[key].evidence)
  }
  for (const key of ['proxy', 'webRtcPolicy']) assert.equal(result.report[key].state, 'unverified')
  console.log(JSON.stringify({ kernelProbe: 'passed-six-offline-checks-no-network-capability-overclaim', version: result.version, platform: process.platform, arch: process.arch }))
} finally { await rm(root, { recursive: true, force: true }) }
