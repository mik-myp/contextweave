import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  assertIntegrityRecord,
  fusePolicy,
  hardenElectron,
  packagedLayout,
  readFuses,
  validateFuseWire,
} from './electron-fuses.mjs'
const roots = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture({ version = 1, states = Array(9).fill(49) } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cw-fuse-test-'))
  roots.push(root)
  const binary = join(root, 'fixture.exe')
  // Only tests the fuse wire, not an executable or proof of Electron enforcement.
  const bytes = Buffer.concat([
    Buffer.from('fixture-dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
    Buffer.from([version, states.length, ...states]),
    Buffer.from('-fixture-end'),
  ])
  await writeFile(binary, bytes)
  return { binary, bytes }
}
test('writes and reads all nine explicit fuse values without changing surrounding bytes', async () => {
  const { binary, bytes } = await fixture()
  const result = await hardenElectron(binary)
  assert.deepEqual(result, { version: '1', values: fusePolicy })
  assert.deepEqual(await readFuses(binary), result)
  const after = await readFile(binary)
  assert.equal(after.length, bytes.length)
  assert.deepEqual(after.subarray(0, 42), bytes.subarray(0, 42))
  assert.deepEqual(after.subarray(-12), bytes.subarray(-12))
})
for (const [label, options] of Object.entries({
  newVersion: { version: 2 },
  missing: { states: Array(8).fill(49) },
  added: { states: Array(10).fill(49) },
  removed: { states: [114, ...Array(8).fill(49)] },
  unknown: { states: [144, ...Array(8).fill(49)] },
}))
  test(`rejects ${label} before mutating the binary`, async () => {
    const { binary, bytes } = await fixture(options)
    await assert.rejects(hardenElectron(binary))
    assert.deepEqual(await readFile(binary), bytes)
  })
test('readback rejects a known but weakened fuse and never treats removed as disabled', () => {
  const wire = {
    version: '1',
    ...Object.fromEntries(Object.values(fusePolicy).map((value, i) => [i, value ? 49 : 48])),
  }
  assert.deepEqual(validateFuseWire(wire).values, fusePolicy)
  assert.throws(() => validateFuseWire({ ...wire, 0: 49 }), /FUSE_POLICY_MISMATCH/)
  assert.throws(() => validateFuseWire({ ...wire, 0: 114 }), /REMOVED_OR_UNKNOWN_FUSE/)
})
test('resolves the exact application under ancestors containing .app instead of truncating the path', () => {
  const root = join(tmpdir(), 'parent.app-cache')
  const archive = join(root, 'ContextWeave.app', 'Contents', 'Resources', 'app.asar')
  const layout = packagedLayout(archive, 'darwin')
  assert.equal(layout.bundle, join(root, 'ContextWeave.app'))
  assert.equal(
    layout.fuseBinary,
    join(layout.bundle, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'),
  )
  assert.throws(
    () => packagedLayout(join(root, 'resources/app.asar'), 'linux'),
    /UNQUALIFIED_PACKAGED_PLATFORM/,
  )
  assert.throws(
    () => packagedLayout(join(root, 'Other.app/Contents/Resources/app.asar'), 'darwin'),
    /UNEXPECTED_BUNDLE_NAME/,
  )
})
test('integrity metadata must use the exact algorithm, hash and record shape', () => {
  const hash = 'a'.repeat(64)
  assertIntegrityRecord({ algorithm: 'SHA256', hash }, hash)
  for (const record of [
    undefined,
    { algorithm: 'SHA1', hash },
    { algorithm: 'SHA256', hash: 'b'.repeat(64) },
    { algorithm: 'SHA256', hash, extra: 'unreviewed' },
  ])
    assert.throws(() => assertIntegrityRecord(record, hash), /ASAR_INTEGRITY_METADATA_MISMATCH/)
})
