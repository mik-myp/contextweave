import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild')
const { createPackage } = require('@electron/asar')
const electron = require('electron')
const root = await mkdtemp(join(tmpdir(), 'cw-update-asar-'))
try {
  const content = join(root, 'archive-source')
  await mkdir(content)
  await writeFile(join(content, 'index.js'), 'module.exports = "fixture"\n')
  await createPackage(content, join(root, 'fixture.asar'))
  buildSync({
    entryPoints: [resolve('apps/desktop/electron/services/app-update-electron.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['original-fs'],
    outfile: join(root, 'installer.cjs'),
    logLevel: 'silent',
  })
  // This must run in real Electron Main, not ELECTRON_RUN_AS_NODE or Vitest's Node host.
  // OS attach/copy/launch are simulated; ASAR interception and installer cleanup are real.
  await writeFile(join(root, 'main.cjs'), `
const assert = require('node:assert/strict')
const { app } = require('electron')
const fs = require('original-fs').promises
const virtualFs = require('node:fs/promises')
const { join } = require('node:path')
const { prepareElectronAppInstaller } = require('./installer.cjs')
app.setPath('userData', join(__dirname, 'user-data'))
app.whenReady().then(async () => {
  assert.ok(process.versions.electron)
  const root = await fs.realpath(__dirname)
  const original = join(root, 'ContextWeave.app')
  const current = join(original, 'Contents', 'MacOS', 'ContextWeave')
  await fs.mkdir(join(original, 'Contents', 'MacOS'), { recursive: true })
  await fs.writeFile(current, 'unchanged current app')
  let mount
  let launched = false
  const makeBundle = async (bundle) => {
    await fs.mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true })
    await fs.mkdir(join(bundle, 'Contents', 'Resources'), { recursive: true })
    const header = Buffer.alloc(32)
    header.writeUInt32LE(0xfeedfacf, 0)
    header.writeUInt32LE(0x0100000c, 4)
    header.writeUInt32LE(2, 12)
    await fs.writeFile(join(bundle, 'Contents', 'MacOS', 'ContextWeave'), header)
    await fs.copyFile(join(root, 'fixture.asar'), join(bundle, 'Contents', 'Resources', 'app.asar'))
  }
  // Positive control proves this host really has the filesystem behavior behind the bug.
  await fs.mkdir(join(root, 'virtual-control'))
  await fs.copyFile(join(root, 'fixture.asar'), join(root, 'virtual-control', 'app.asar'))
  assert.ok((await virtualFs.lstat(join(root, 'virtual-control', 'app.asar'))).isDirectory())
  const prepared = await prepareElectronAppInstaller({
    platform: 'darwin', arch: 'arm64', isPackaged: true, portable: false,
    executablePath: current, root: join(root, 'updates'),
    path: join(root, 'ContextWeave-0.2.7-mac-arm64.dmg'),
    release: { version: '0.2.7', url: 'https://github.com/mik-myp/contextweave/releases/tag/v0.2.7', publishedAt: '2026-09-28T05:07:26Z' },
    signal: new AbortController().signal,
  }, {
    async execute(file, args) {
      if (file.endsWith('hdiutil') && args[0] === 'attach') {
        mount = args[args.indexOf('-mountpoint') + 1]
        await makeBundle(join(mount, 'ContextWeave.app'))
      } else if (file.endsWith('hdiutil')) {
        await fs.rm(join(mount, 'ContextWeave.app'), { recursive: true })
      } else if (file.endsWith('plutil')) {
        return { stdout: args[1] === 'CFBundleIdentifier' ? 'com.mikmyp.contextweave' : args[1] === 'CFBundleExecutable' ? 'ContextWeave' : '0.2.7', stderr: '' }
      } else if (file.endsWith('ditto')) {
        await fs.cp(args[0], args[1], { recursive: true, verbatimSymlinks: true })
      }
      return { stdout: '', stderr: 'TeamIdentifier=not set' }
    },
    async launch(_file, args) {
      launched = true
      await fs.writeFile(args[4], 'ready\\n')
    },
  })
  const staging = (await fs.readdir(root)).find(name => name.startsWith('.contextweave-update-'))
  assert.ok(staging)
  assert.ok((await fs.lstat(join(root, staging, 'ContextWeave.app', 'Contents', 'Resources', 'app.asar'))).isFile())
  assert.equal(await fs.readFile(current, 'utf8'), 'unchanged current app')
  assert.deepEqual(await fs.readdir(join(root, 'updates')), [])
  assert.equal(launched, false)
  await prepared.launch()
  assert.equal(launched, true)
  await prepared.cleanup()
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.contextweave-update-')), false)
  assert.equal(await fs.readFile(current, 'utf8'), 'unchanged current app')
  console.log('UPDATE_ASAR_SMOKE_OK')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await promisify(execFile)(electron, [join(root, 'main.cjs')], {
    env, timeout: 30_000, encoding: 'utf8',
  })
  assert.match(result.stdout, /UPDATE_ASAR_SMOKE_OK/)
  console.log('Application updater: real Electron ASAR boundary, preparation, handshake and cleanup passed. OS installer commands were simulated.')
} finally {
  // The separate Electron process has exited and released any negative-control ASAR cache.
  await rm(root, { recursive: true, force: true })
}
