import { finished } from 'node:stream/promises'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  WriteStream,
} from 'node:fs'
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
async function createFixtureArchive(source, archive) {
  // Qualified ASAR 3.4.1 returns out.end(), not a promise for writable completion.
  // Waiting for the actual stream avoids reading a header whose payload is still pending.
  const output = await asar.createPackage(source, archive)
  assert(output instanceof WriteStream, 'ASAR fixture creator must expose its output stream')
  await finished(output, { cleanup: true })
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
  await createFixtureArchive(source, archive)
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
    const electronEvidence = { fixture: 'not-real-binary-evidence' }
    const names = await stageArtifacts(
      { versionRoot, destination, target, version: '0.1.6' },
      {
        inspectElectron: async (candidate, platform) => {
          assert.equal(candidate, archive)
          assert.equal(platform, getTarget(target).platform)
          return electronEvidence
        },
      },
    )
    assert.equal(names.length, 4)
    assert.deepEqual(readdirSync(destination).sort(), names.sort())
    const inventory = JSON.parse(
      readFileSync(join(destination, `contextweave-packaged-${target}.json`), 'utf8'),
    )
    assert.equal(inventory.formatVersion, 2)
    assert.equal(inventory.payloadVerification.packedFiles, 7)
    assert.equal(inventory.payloadVerification.algorithm, 'SHA256')
    assert.deepEqual(inventory.electron, electronEvidence)
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

test('default artifact staging refuses fixture installers without a real hardened Electron binary', async () => {
  const root = temp()
  const { versionRoot } = await bundle(root, 'windows-x64')
  const destination = join(root, 'artifacts')
  await assert.rejects(
    stageArtifacts({ versionRoot, destination, target: 'windows-x64', version: '0.1.6' }),
    /ENOENT/,
  )
  assert(
    !readdirSync(root).includes('artifacts'),
    'No attachment should be staged after a binary audit failure',
  )
})

test('ASAR fixture waits for pending payload writes and actual output close, not merely creator resolution', async (t) => {
  const root = temp()
  const source = join(root, 'source'),
    archive = join(root, 'app.asar')
  const payload = Buffer.from(
    JSON.stringify({ name: 'delayed-real-asar-fixture', version: '1.0.0' }),
  )
  write(source, 'package.json', payload)
  const originalWrite = WriteStream.prototype._write
  const originalCreate = asar.createPackage
  let releaseWrite, output
  let creatorResolved
  const created = new Promise((resolve) => {
    creatorResolved = resolve
  })
  t.mock.method(WriteStream.prototype, '_write', function (data, encoding, callback) {
    if (String(this.path) === archive && data.equals(payload))
      releaseWrite = () => originalWrite.call(this, data, encoding, callback)
    else originalWrite.call(this, data, encoding, callback)
  })
  t.mock.method(asar, 'createPackage', async (...args) => {
    output = await originalCreate(...args)
    creatorResolved()
    return output
  })
  let ready = false
  const packed = createFixtureArchive(source, archive).then(() => {
    ready = true
  })
  try {
    await created
    // Give the creator's promise chain a complete turn; without the finished wait,
    // the helper would already report ready while our controlled payload is blocked.
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(typeof releaseWrite, 'function')
    assert.equal(output.writableFinished, false)
    assert.equal(output.closed, false)
    assert.equal(ready, false, 'Fixture must not report readiness with pending output')
    // Deterministically reproduces the tag failure before permitting the real OS write.
    const premature = asar.extractFile(archive, 'package.json')
    assert(premature.every((byte) => byte === 0))
    assert.throws(() => JSON.parse(premature.toString('utf8')), SyntaxError)
    releaseWrite()
    releaseWrite = undefined
    await packed
    assert.equal(output.writableFinished, true)
    assert.equal(output.closed, true)
    assert.deepEqual(asar.extractFile(archive, 'package.json'), payload)
  } finally {
    releaseWrite?.()
    if (output) await finished(output, { cleanup: true })
    await packed
  }
})

for (const corruption of ['truncated', 'trailing', 'payload', 'algorithm', 'offset'])
  test(`rejects ${corruption} ASAR contents before staging any attachments`, async () => {
    const root = temp()
    const { archive, versionRoot } = await bundle(root)
    const original = readFileSync(archive)
    let damaged = Buffer.from(original)
    if (corruption === 'truncated') damaged = damaged.subarray(0, damaged.length - 1)
    if (corruption === 'trailing') damaged = Buffer.concat([damaged, Buffer.from([0])])
    if (corruption === 'payload') {
      const entry = asar.statFile(archive, 'dist-electron/worker.js')
      damaged[8 + asar.getRawHeader(archive).headerSize + Number(entry.offset)] ^= 1
    }
    if (corruption === 'offset') {
      const needle = Buffer.from('"offset":"0"')
      const index = damaged.indexOf(needle)
      assert(index >= 0)
      damaged[index + needle.indexOf('0')] = '1'.charCodeAt(0)
    }
    if (corruption === 'algorithm') {
      const index = damaged.indexOf(Buffer.from('SHA256'))
      assert(index >= 0)
      damaged[index + 5] = '5'.charCodeAt(0)
    }
    writeFileSync(archive, damaged)
    const destination = join(root, 'attachments')
    await assert.rejects(
      stageArtifacts({ versionRoot, destination, target: 'macos-arm64', version: '0.1.6' }),
      corruption === 'payload'
        ? /PACKAGED_PAYLOAD_DIGEST_MISMATCH/
        : corruption === 'algorithm'
          ? /PACKAGED_PAYLOAD_METADATA_INVALID/
          : corruption === 'offset'
            ? /PACKAGED_PAYLOAD_OFFSETS_INVALID/
            : /PACKAGED_PAYLOAD_LENGTH_MISMATCH/,
    )
    assert(!readdirSync(root).includes('attachments'))
    writeFileSync(archive, original)
    const audited = await auditPackage(archive, 'macos-arm64', '0.1.6')
    assert.equal(audited.payloadVerification.packedFiles, 7)
  })

test('verifies empty packed files without reading adjacent payload bytes or rejecting shared zero-length offsets', async () => {
  const root = temp()
  const { archive } = await bundle(root)
  const source = join(root, 'source')
  write(source, 'a-empty', '')
  write(source, 'z-empty', '')
  await createFixtureArchive(source, archive)
  const result = await auditPackage(archive, 'macos-arm64', '0.1.6')
  assert.equal(result.payloadVerification.packedFiles, 9)
})
