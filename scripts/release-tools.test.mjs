import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  auditPackage,
  expectedArtifacts,
  getTarget,
  releaseTagFromEnvironment,
  sha256File,
  stageArtifacts,
  verifyVersions,
} from './release-tools.mjs'

const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const asar = desktopRequire('@electron/asar')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function temp() {
  const root = mkdtempSync(join(tmpdir(), 'cw-release-tools-'))
  roots.push(root)
  return root
}
function write(root, path, value) {
  const file = join(root, path)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, value)
}
async function bundle(
  root,
  target = 'macos-arm64',
  version = '0.1.6',
  dependencies = { 'runtime-fixture': '1.0.0' },
) {
  const source = join(root, 'source')
  write(source, 'package.json', JSON.stringify({ name: 'contextweave', version, dependencies }))
  for (const path of [
    'dist/index.html',
    'dist-electron/main.js',
    'dist-electron/preload.cjs',
    'dist-electron/worker.js',
  ])
    write(source, path, 'fixture')
  write(
    source,
    'node_modules/runtime-fixture/package.json',
    JSON.stringify({ name: 'runtime-fixture', version: '1.0.0', license: 'MIT' }),
  )
  write(source, 'node_modules/runtime-fixture/esm/package.json', JSON.stringify({ type: 'module' }))
  const versionRoot = join(root, 'release', version)
  const archive = join(versionRoot, 'unpacked', 'resources', 'app.asar')
  mkdirSync(join(archive, '..'), { recursive: true })
  await asar.createPackage(source, archive)
  for (const name of expectedArtifacts(version, target))
    write(versionRoot, name, 'fixture installer; not an executable')
  return { archive, versionRoot }
}

test('verifies every workspace version and rejects a mismatched or unsafe tag', () => {
  const root = temp()
  for (const file of [
    'package.json',
    'apps/desktop/package.json',
    'packages/contracts/package.json',
  ])
    write(root, file, '{"version":"0.1.6"}')
  assert.equal(verifyVersions(root, 'v0.1.6'), '0.1.6')
  assert.throws(() => verifyVersions(root, 'v0.1.5'), /TAG_VERSION_MISMATCH/)
  write(root, 'packages/contracts/package.json', '{"version":"0.1.5"}')
  assert.throws(() => verifyVersions(root), /WORKSPACE_VERSION_MISMATCH/)
  for (const target of ['../escape', 'constructor', 'linux-x64'])
    assert.throws(() => getTarget(target), /UNSUPPORTED_BUILD_TARGET/)
  assert.throws(() => expectedArtifacts('../escape', 'windows-x64'), /INVALID_APP_VERSION/)
})

for (const target of ['windows-x64', 'macos-x64', 'macos-arm64'])
  test(`stages only the two expected installers and an actual ASAR inventory for ${target}`, async () => {
    const root = temp()
    const { versionRoot, archive } = await bundle(root, target)
    write(versionRoot, 'unrelated-installer.exe', 'must not publish')
    const destination = join(root, 'artifacts', target)
    const names = await stageArtifacts({ versionRoot, destination, target, version: '0.1.6' })
    assert.equal(names.length, 4)
    assert.deepEqual(readdirSync(destination).sort(), names.sort())
    const inventory = JSON.parse(
      readFileSync(join(destination, `contextweave-packaged-${target}.json`), 'utf8'),
    )
    assert.equal(inventory.application.arch, getTarget(target).arch)
    assert.equal(inventory.application.version, '0.1.6')
    assert.equal(inventory.asar.sha256, await sha256File(archive))
    assert.equal(inventory.packages.length, 1)
    assert.equal(inventory.packages[0].name, 'runtime-fixture')
    assert.equal(inventory.bundledEntries.length, 4)
    for (const line of readFileSync(join(destination, `SHA256SUMS-${target}.txt`), 'utf8')
      .trim()
      .split('\n')) {
      const [hash, name] = line.split('  ')
      assert.equal(hash, await sha256File(join(destination, name)))
    }
    await assert.rejects(
      stageArtifacts({ versionRoot, destination, target, version: '0.1.6' }),
      /ARTIFACT_OUTPUT_EXISTS/,
    )
  })

test('fails before staging when packaged versions or runtime dependencies are wrong', async () => {
  const root = temp()
  const { archive, versionRoot } = await bundle(root)
  await assert.rejects(auditPackage(archive, 'macos-arm64', '0.1.7'), /PACKAGED_VERSION_MISMATCH/)
  rmSync(join(versionRoot, expectedArtifacts('0.1.6', 'macos-arm64')[0]))
  await assert.rejects(
    stageArtifacts({
      versionRoot,
      destination: join(root, 'out'),
      target: 'macos-arm64',
      version: '0.1.6',
    }),
  )
  const second = temp()
  const missing = await bundle(second, 'macos-arm64', '0.1.6', { 'missing-runtime': '1.0.0' })
  await assert.rejects(
    auditPackage(missing.archive, 'macos-arm64', '0.1.6'),
    /MISSING_PACKAGED_DEPENDENCY/,
  )
})

test('checks only actual tag refs, not branch or pull-request names', () => {
  assert.equal(
    releaseTagFromEnvironment({ GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'master' }),
    undefined,
  )
  assert.equal(
    releaseTagFromEnvironment({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.1.6' }),
    'v0.1.6',
  )
})
