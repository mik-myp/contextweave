// Observes an explicitly supplied local browser against a loopback-only fixture.
// It does not download browsers or turn observations into a provider qualification.
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    provider: { type: 'string', default: 'standard-chromium' },
    output: { type: 'string' },
    sha256: { type: 'string' },
  },
})
if (!values.executable) throw new Error('Provide --executable with an approved local browser path')
const executable = resolve(values.executable)
const digest = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex')
if (values.sha256 && values.sha256.toLowerCase() !== digest)
  throw new Error('Executable SHA-256 does not match')
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const root = await mkdtemp(join(tmpdir(), 'cw-provider-verification-'))
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(
    '<!doctype html><title>ContextWeave local verification</title><h1>Browser identity fixture</h1>',
  )
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = `http://127.0.0.1:${server.address().port}`
const runs = []
try {
  for (let run = 0; run < 2; run++) {
    const context = await chromium.launchPersistentContext(root, {
      executablePath: executable,
      headless: true,
      args: ['--disable-background-networking'],
      viewport: null,
    })
    try {
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === url ? route.continue() : route.abort(),
      )
      const page = await context.newPage()
      await page.goto(url)
      const observation = await page.evaluate(() => {
        const canvas = document.createElement('canvas'),
          gl = canvas.getContext('webgl'),
          debug = gl?.getExtension('WEBGL_debug_renderer_info')
        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          languages: navigator.languages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          cores: navigator.hardwareConcurrency,
          webgl: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          persisted: localStorage.getItem('cw-verification'),
        }
      })
      await page.evaluate(() => localStorage.setItem('cw-verification', 'retained'))
      runs.push({ version: context.browser()?.version(), ...observation })
    } finally {
      await context.close()
    }
  }
  const identity = ({ persisted: _persisted, ...value }) => value
  const report = {
    provider: values.provider,
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    executableSha256: digest,
    scope: 'loopback page; headless; two launches; no engine-level spoofing claim',
    qualification: 'observations-only',
    stable: JSON.stringify(identity(runs[0])) === JSON.stringify(identity(runs[1])),
    profileRetained: runs[1].persisted === 'retained',
    runs,
  }
  const text = JSON.stringify(report, null, 2) + '\n'
  if (values.output) await writeFile(resolve(values.output), text)
  console.log(text)
  if (!report.stable || !report.profileRetained) process.exitCode = 1
} finally {
  server.close()
  await rm(root, { recursive: true, force: true })
}
