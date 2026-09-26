// Negative tests run only on disposable copies, with one-fuse positive controls.
// Never attach to the Main inspector, bypass IPC, or change an installed application.
import assert from 'node:assert/strict'
import { constants, existsSync } from 'node:fs'
import { cp, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findPackagedArchive, sha256File } from './release-tools.mjs'
import {
  fuseConfig,
  fusePolicy,
  packagedLayout,
  readFuses,
  signAdHocBundle,
  validateFuseWire,
  verifyEmbeddedIntegrity,
  verifyBundleSignature,
} from './electron-fuses.mjs'
import { launchNative, spawnOwned, stopOwned, until } from './native-packaged-host.mjs'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { flipFuses, getCurrentFuseWire } = await import(
  pathToFileURL(require.resolve('@electron/fuses')).href
)
const asar = require('@electron/asar')
const appRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const { version } = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const original = packagedLayout(
  findPackagedArchive(join(appRoot, 'release', version)),
  process.platform,
)
const originalHashes = await Promise.all([
  sha256File(original.fuseBinary),
  sha256File(original.archive),
])
await readFuses(original.fuseBinary)
await verifyEmbeddedIntegrity(original)
const directory = await mkdtemp(join(tmpdir(), 'cw-fuse-negative-'))
let stage = 'copy',
  primaryFailure = false,
  retain = false,
  runs = 0
try {
  const bundle = join(
    directory,
    'parent.app-cache',
    process.platform === 'darwin' ? 'ContextWeave.app' : 'unpacked',
  )
  await cp(original.bundle, bundle, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  })
  const layout = packagedLayout(
    join(
      bundle,
      process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar',
    ),
    process.platform,
  )
  const sign = async () => {
    if (process.platform === 'darwin') await signAdHocBundle(bundle)
  }
  async function configure(index, value) {
    await flipFuses(layout.fuseBinary, {
      ...fuseConfig,
      ...(index === undefined ? {} : { [index]: value }),
    })
    const expected = { ...fusePolicy }
    if (index !== undefined) expected[Object.keys(expected)[index]] = value
    assert.deepEqual(
      validateFuseWire(await getCurrentFuseWire(layout.fuseBinary), false).values,
      expected,
      'TEST_CONTROL_FUSE_MISMATCH',
    )
    await sign()
  }
  let snapshots = 0
  async function executableSnapshot() {
    // Never rewrite a bundle after that path has executed. macOS and Chromium may
    // cache bundle/resource state; every observation gets immutable build-like input.
    const snapshot = join(
      directory,
      `execution-${++snapshots}`,
      process.platform === 'darwin' ? 'ContextWeave.app' : 'unpacked',
    )
    await cp(layout.bundle, snapshot, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    })
    const copied = packagedLayout(
      join(
        snapshot,
        process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar',
      ),
      process.platform,
    )
    assert.equal(
      await sha256File(copied.fuseBinary),
      await sha256File(layout.fuseBinary),
      'SNAPSHOT_BINARY_MISMATCH',
    )
    if (process.platform === 'darwin') await verifyBundleSignature(copied.bundle)
    return copied
  }
  async function runApp(options, verify) {
    let host,
      failed = false
    try {
      const snapshot = await executableSnapshot()
      host = await launchNative(snapshot, join(directory, `profile-${++runs}`), options)
      await verify(host)
      await host.quit()
    } catch (error) {
      failed = true
      if (error.nativeProcessUnconfirmed) retain = true
      throw error
    } finally {
      try {
        await host?.close()
      } catch (error) {
        retain = true
        if (!failed) throw error
        console.error('FUSE_CONTROL_CLEANUP_FAILED_AFTER_PRIMARY_ERROR')
      }
    }
  }
  async function runProcess(args, env, verify) {
    const snapshot = await executableSnapshot()
    const state = spawnOwned(snapshot.executable, args, env)
    let failed = false
    try {
      const exit = await until(
        () => {
          if (state.spawnError) throw new Error('CONTROL_SPAWN_FAILED')
          return state.exit
        },
        15000,
        'CONTROL_DID_NOT_EXIT',
      )
      await verify(state, exit)
    } catch (error) {
      failed = true
      console.error(
        JSON.stringify({
          controlFailure: stage,
          exitObserved: Boolean(state.exit),
          markerObserved: markerExists(),
          spawned: !state.spawnError,
          asarRejection: /Integrity check failed for asar archive/i.test(state.stderr),
        }),
      )
      throw error
    } finally {
      try {
        await stopOwned(state)
      } catch (error) {
        retain = true
        if (!failed) throw error
        console.error('FUSE_CONTROL_CLEANUP_FAILED_AFTER_PRIMARY_ERROR')
      }
    }
  }
  const marker = join(directory, 'executed.marker')
  const markCode = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fixture-executed')`
  const clearMarker = () => rm(marker, { force: true })
  const markerExists = () => existsSync(marker)
  // This fixture must have valid embedded integrity metadata and a valid OS signature.
  // It reads a supported numeric Node option; packaged --require is already filtered,
  // and malformed options are not a reliable cross-platform exit control.
  async function updateFixtureIntegrity() {
    const hash = createHash('sha256')
      .update(asar.getRawHeader(layout.archive).headerString)
      .digest('hex')
    if (process.platform === 'darwin') {
      await promisify(execFile)(
        '/usr/bin/plutil',
        [
          '-replace',
          'ElectronAsarIntegrity',
          '-json',
          JSON.stringify({ 'Resources/app.asar': { algorithm: 'SHA256', hash } }),
          join(bundle, 'Contents/Info.plist'),
        ],
        { timeout: 10000 },
      )
    } else {
      const builderRequire = createRequire(require.resolve('electron-builder'))
      const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
      const { NtExecutable, NtExecutableResource } = appBuilderRequire('resedit')
      const executable = NtExecutable.from(await readFile(layout.executable), { ignoreCert: true })
      const resources = NtExecutableResource.from(executable)
      const records = resources.entries.filter(
        (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR',
      )
      assert.equal(records.length, 1)
      records[0].bin = Buffer.from(
        JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }]),
      )
      resources.outputResource(executable)
      await writeFile(layout.executable, Buffer.from(executable.generate()))
    }
    await verifyEmbeddedIntegrity(layout)
  }
  stage = 'node-options'
  const optionsSource = join(directory, 'node-options-fixture')
  await mkdir(optionsSource)
  await writeFile(
    join(optionsSource, 'package.json'),
    JSON.stringify({ name: 'cw-options-fixture', version, main: 'main.cjs' }),
  )
  await writeFile(
    join(optionsSource, 'main.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(require('node:http').maxHeaderSize)); require('electron').app.exit(0)`,
  )
  const optionsBackup = join(directory, 'options-original.asar')
  await rename(layout.archive, optionsBackup)
  await asar.createPackage(optionsSource, layout.archive)
  await updateFixtureIntegrity()
  await configure()
  let defaultHeaderSize
  const optionProcessArgs = () => [`--user-data-dir=${join(directory, `profile-${++runs}`)}`]
  await runProcess(optionProcessArgs(), {}, async (_state, exit) => {
    assert.deepEqual(exit, { code: 0, signal: null })
    defaultHeaderSize = Number(await readFile(marker, 'utf8'))
    assert(
      Number.isInteger(defaultHeaderSize) && defaultHeaderSize > 4096,
      'INVALID_OPTIONS_FIXTURE_BASELINE',
    )
  })
  await clearMarker()
  const optionsEnv = { NODE_OPTIONS: '--max-http-header-size=4096' }
  await runProcess(optionProcessArgs(), optionsEnv, async (_state, exit) => {
    assert.deepEqual(exit, { code: 0, signal: null })
    assert.equal(
      Number(await readFile(marker, 'utf8')),
      defaultHeaderSize,
      'NODE_OPTIONS_HONORED_WITH_FUSE_OFF',
    )
  })
  await clearMarker()
  await configure(2, true)
  await runProcess(optionProcessArgs(), optionsEnv, async (_state, exit) => {
    assert.deepEqual(exit, { code: 0, signal: null })
    assert.equal(
      Number(await readFile(marker, 'utf8')),
      4096,
      'NODE_OPTIONS_POSITIVE_CONTROL_NOT_HONORED',
    )
  })
  await clearMarker()
  await rm(layout.archive)
  await rename(optionsBackup, layout.archive)
  await updateFixtureIntegrity()
  console.log(
    JSON.stringify({
      fuseCase: stage,
      negative: 'passed',
      positiveControl: 'one-fuse-change-supported-option-observed-valid-fixture-signature',
    }),
  )

  stage = 'run-as-node'
  await configure()
  await runApp({ env: { ELECTRON_RUN_AS_NODE: '1' }, args: ['-e', markCode] }, async () =>
    assert(!markerExists(), 'RUN_AS_NODE_EXECUTED_WITH_FUSE_OFF'),
  )
  await configure(0, true)
  // Node mode has no app/user directory; the only side effect is this owned marker.
  await runProcess(['-e', markCode], { ELECTRON_RUN_AS_NODE: '1' }, async (_state, exit) => {
    assert.deepEqual(exit, { code: 0, signal: null })
    assert(markerExists(), 'RUN_AS_NODE_POSITIVE_CONTROL_DID_NOT_EXECUTE')
  })
  await clearMarker()
  console.log(
    JSON.stringify({
      fuseCase: stage,
      negative: 'passed',
      positiveControl: 'one-fuse-change-passed',
    }),
  )

  stage = 'node-inspector'
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  )
  const inspectorOption = { args: [`--inspect=127.0.0.1:${port}`] }
  const inspectorUrl = `http://127.0.0.1:${port}/json/list`
  await configure()
  await runApp(inspectorOption, async (host) => {
    assert(
      !host.state.stderr.includes('Debugger listening'),
      'NODE_INSPECTOR_ANNOUNCED_WITH_FUSE_OFF',
    )
    await assert.rejects(
      fetch(inspectorUrl, { signal: AbortSignal.timeout(2000) }),
      'NODE_INSPECTOR_REACHABLE_WITH_FUSE_OFF',
    )
  })
  await configure(3, true)
  await runApp(inspectorOption, async (host) => {
    assert(
      host.state.stderr.includes('Debugger listening'),
      'NODE_INSPECTOR_POSITIVE_CONTROL_NOT_ANNOUNCED',
    )
    const targets = await (await fetch(inspectorUrl, { signal: AbortSignal.timeout(2000) })).json()
    assert(
      Array.isArray(targets) && targets.some((target) => target.type === 'node'),
      'NODE_INSPECTOR_POSITIVE_CONTROL_NOT_LISTENING',
    )
    // No connection, evaluation, secret or credential is sent to the Main inspector.
  })
  console.log(
    JSON.stringify({
      fuseCase: stage,
      negative: 'passed',
      positiveControl: 'one-fuse-change-passed-no-main-evaluation',
    }),
  )

  const source = join(directory, 'app-fixture')
  await mkdir(source)
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ name: 'cw-negative-fixture', version, main: 'main.cjs' }),
  )
  await writeFile(join(source, 'main.cjs'), `${markCode}; require('electron').app.exit(0)`)
  const savedArchive = join(directory, 'original-app.asar')
  await copyFile(layout.archive, savedArchive)
  const processArgs = () => [`--user-data-dir=${join(directory, `profile-${++runs}`)}`]

  stage = 'asar-tamper'
  await rm(layout.archive)
  await asar.createPackage(source, layout.archive)
  // Leave embedded integrity metadata unchanged. Re-sign the changed resources so an
  // invalid OS signature cannot masquerade as Electron's ASAR rejection.
  await configure()
  await runProcess(processArgs(), {}, async (state, exit) => {
    assert(exit.code !== 0 || exit.signal, 'TAMPERED_ASAR_NOT_REJECTED')
    assert(!markerExists(), 'TAMPERED_ASAR_EXECUTED')
    assert.match(
      state.stderr,
      /Integrity check failed for asar archive/i,
      'MISSING_ASAR_INTEGRITY_REJECTION_DIAGNOSTIC',
    )
  })
  await configure(4, false)
  await runProcess(processArgs(), {}, async (_state, exit) => {
    assert.deepEqual(exit, { code: 0, signal: null })
    assert(markerExists(), 'ASAR_POSITIVE_CONTROL_DID_NOT_EXECUTE')
  })
  await clearMarker()
  await copyFile(savedArchive, layout.archive)
  console.log(
    JSON.stringify({
      fuseCase: stage,
      negative: 'passed',
      positiveControl: 'one-fuse-change-passed-valid-signature',
    }),
  )

  stage = 'app-directory-fallback'
  await rename(layout.archive, join(directory, 'removed-app.asar'))
  await cp(source, join(layout.resources, 'app'), { recursive: true })
  await configure()
  await runProcess(processArgs(), {}, async (_state, exit) => {
    assert.deepEqual(exit, { code: 1, signal: null }, 'APP_FALLBACK_NOT_REJECTED')
    assert(!markerExists(), 'APP_DIRECTORY_EXECUTED_WITH_FUSE_ON')
    // Electron's early process.exit(1) can suppress stderr. The valid signature,
    // exact exit, absent marker and one-fuse positive control identify the boundary.
  })
  await configure(5, false)
  await runProcess(processArgs(), {}, async (_state, exit) => {
    assert.deepEqual(exit, { code: 0, signal: null })
    assert(markerExists(), 'APP_FALLBACK_POSITIVE_CONTROL_DID_NOT_EXECUTE')
  })
  await clearMarker()
  await rm(join(layout.resources, 'app'), { recursive: true })
  await rename(join(directory, 'removed-app.asar'), layout.archive)
  await configure()
  await verifyEmbeddedIntegrity(layout)
  await runApp({}, async () => {})
  console.log(
    JSON.stringify({
      fuseCase: stage,
      negative: 'passed',
      positiveControl: 'one-fuse-change-passed-valid-signature',
    }),
  )
  assert.deepEqual(
    await Promise.all([sha256File(original.fuseBinary), sha256File(original.archive)]),
    originalHashes,
    'ORIGINAL_PACKAGE_WAS_MODIFIED',
  )
} catch (error) {
  primaryFailure = true
  console.error(JSON.stringify({ packagedFuseNegativeTests: 'failed', stage }))
  throw error
} finally {
  if (!retain) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      if (!primaryFailure) throw error
      console.error('FUSE_FIXTURE_CLEANUP_FAILED_AFTER_PRIMARY_ERROR')
    }
  } else console.error('FUSE_TEST_FIXTURE_RETAINED_UNCONFIRMED_PROCESS_EXIT')
}

console.log(
  JSON.stringify({
    packagedFuseNegativeTests: 'passed',
    originalPackage: 'unchanged',
    platform: process.platform,
    arch: process.arch,
  }),
)
