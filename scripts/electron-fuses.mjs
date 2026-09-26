// Build-time policy only. Never imported by the application or shipped in app.asar.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { FuseVersion, FuseV1Options, FuseState, flipFuses, getCurrentFuseWire } = await import(
  pathToFileURL(require.resolve('@electron/fuses')).href
)
const asar = require('@electron/asar')
const exec = promisify(execFile)
export const qualifiedElectronVersion = '44.4.3'
export const fusePolicy = Object.freeze({
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
  WasmTrapHandlers: true,
})
const entries = Object.entries(fusePolicy)
for (const [index, [name]] of entries.entries())
  assert.equal(FuseV1Options[name], index, 'FUSE_TOOL_ENUM_CHANGED')
assert.equal(Object.keys(FuseV1Options).length, 18, 'FUSE_TOOL_ENUM_CHANGED')
export const fuseConfig = Object.freeze({
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  // The tool's path splitting can misidentify an ancestor with '.app' in its name.
  // The hook signs the exact bundle, and builder may then apply a distribution identity.
  resetAdHocDarwinSignature: false,
  ...Object.fromEntries(entries.map(([name, value]) => [FuseV1Options[name], value])),
})
export function validateFuseWire(wire, expected = true) {
  assert.equal(wire.version, FuseVersion.V1, 'UNSUPPORTED_FUSE_VERSION')
  assert.deepEqual(
    Object.keys(wire).sort(),
    ['version', ...entries.map((_, i) => String(i))].sort(),
    'UNSUPPORTED_FUSE_COUNT',
  )
  const values = {}
  for (const [index, [name, enabled]] of entries.entries()) {
    assert([FuseState.ENABLE, FuseState.DISABLE].includes(wire[index]), 'REMOVED_OR_UNKNOWN_FUSE')
    values[name] = wire[index] === FuseState.ENABLE
    if (expected) assert.equal(values[name], enabled, `FUSE_POLICY_MISMATCH: ${name}`)
  }
  return { version: wire.version, values }
}
export async function readFuses(binary) {
  return validateFuseWire(await getCurrentFuseWire(binary))
}
export async function hardenElectron(binary) {
  // Validate before mutation: the upstream flipper only warns for removed fuses.
  validateFuseWire(await getCurrentFuseWire(binary), false)
  const count = await flipFuses(binary, fuseConfig)
  assert.equal(count, 1, 'ONLY_SINGLE_ARCH_PACKAGES_QUALIFIED')
  return readFuses(binary)
}
export function packagedLayout(archive, platform) {
  assert.equal(basename(archive), 'app.asar', 'UNEXPECTED_ARCHIVE_NAME')
  const resources = dirname(archive)
  if (platform === 'darwin') {
    assert.equal(basename(resources), 'Resources', 'UNEXPECTED_RESOURCE_DIRECTORY')
    assert.equal(basename(dirname(resources)), 'Contents', 'UNEXPECTED_BUNDLE_LAYOUT')
    const bundle = dirname(dirname(resources))
    assert.equal(basename(bundle), 'ContextWeave.app', 'UNEXPECTED_BUNDLE_NAME')
    return {
      platform,
      archive,
      resources,
      bundle,
      executable: join(bundle, 'Contents/MacOS/ContextWeave'),
      fuseBinary: join(
        bundle,
        'Contents/Frameworks/Electron Framework.framework/Electron Framework',
      ),
    }
  }
  assert.equal(platform, 'win32', 'UNQUALIFIED_PACKAGED_PLATFORM')
  assert.equal(basename(resources), 'resources', 'UNEXPECTED_RESOURCE_DIRECTORY')
  const bundle = dirname(resources)
  const executable = join(bundle, 'ContextWeave.exe')
  return { platform, archive, resources, bundle, executable, fuseBinary: executable }
}
export function assertIntegrityRecord(record, hash) {
  assert.deepEqual(record, { algorithm: 'SHA256', hash }, 'ASAR_INTEGRITY_METADATA_MISMATCH')
}
export async function verifyEmbeddedIntegrity(layout) {
  const hash = createHash('sha256')
    .update(asar.getRawHeader(layout.archive).headerString)
    .digest('hex')
  if (layout.platform === 'darwin') {
    const { stdout } = await exec(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', join(layout.bundle, 'Contents/Info.plist')],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    )
    const plist = JSON.parse(stdout)
    const frameworkVersion = await exec(
      '/usr/bin/plutil',
      [
        '-extract',
        'CFBundleVersion',
        'raw',
        join(
          layout.bundle,
          'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist',
        ),
      ],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    )
    assert.equal(
      frameworkVersion.stdout.trim(),
      qualifiedElectronVersion,
      'UNQUALIFIED_ELECTRON_VERSION',
    )
    const metadata = plist.ElectronAsarIntegrity
    assert.deepEqual(
      Object.keys(metadata ?? {}),
      ['Resources/app.asar'],
      'UNEXPECTED_ASAR_INTEGRITY_ENTRIES',
    )
    assertIntegrityRecord(metadata['Resources/app.asar'], hash)
  } else {
    // Reuse the pinned builder's public PE resource reader, not a hand-written PE parser.
    // No production dependency or change to builder's own fuse tool is introduced.
    const builderRequire = createRequire(require.resolve('electron-builder'))
    const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
    const { NtExecutable, NtExecutableResource } = appBuilderRequire('resedit')
    const executable = NtExecutable.from(await readFile(layout.executable), { ignoreCert: true })
    const records = NtExecutableResource.from(executable).entries.filter(
      (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR',
    )
    assert.equal(records.length, 1, 'EXPECTED_SINGLE_WINDOWS_INTEGRITY_RESOURCE')
    const values = JSON.parse(Buffer.from(records[0].bin).toString('utf8'))
    assert.deepEqual(
      values,
      [{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }],
      'ASAR_INTEGRITY_METADATA_MISMATCH',
    )
  }
  return {
    algorithm: 'SHA256',
    headerHash: hash,
    location:
      layout.platform === 'darwin'
        ? 'Info.plist/ElectronAsarIntegrity'
        : 'PE/INTEGRITY/ELECTRONASAR',
  }
}
export async function signAdHocBundle(bundle) {
  assert.equal(basename(bundle), 'ContextWeave.app', 'UNEXPECTED_SIGNING_BUNDLE')
  await exec(
    '/usr/bin/codesign',
    [
      '--sign',
      '-',
      '--force',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      '--deep',
      bundle,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  )
  await verifyBundleSignature(bundle)
}
export async function verifyBundleSignature(bundle) {
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
}
