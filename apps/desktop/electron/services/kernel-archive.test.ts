import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { extractZip } from './kernel-archive'
import { zipFixtures } from './fixtures/kernel-zips'
const directories: string[] = []
afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(name: keyof typeof zipFixtures) {
  const root = await mkdtemp(join(tmpdir(), 'cw-zip-security-'))
  directories.push(root)
  const path = join(root, 'input.zip'),
    destination = join(root, 'payload')
  await mkdir(destination)
  await writeFile(path, Buffer.from(zipFixtures[name], 'base64'))
  return { root, path, destination }
}
it('extracts bytes from a real ZIP without invoking external unzip tools', async () => {
  const f = await fixture('valid')
  await extractZip(f.path, f.destination, new AbortController().signal)
  expect(await readFile(join(f.destination, 'browser', 'readme.txt'), 'utf8')).toBe(
    'harmless fixture',
  )
})
it.each(['traversal', 'backslash', 'symlink', 'oversized'] as const)(
  'rejects a real %s ZIP before writing unsafe output',
  async (name) => {
    const f = await fixture(name)
    await expect(extractZip(f.path, f.destination, new AbortController().signal)).rejects.toThrow()
    expect(await readdir(f.destination)).toEqual([])
    expect((await readdir(f.root)).sort()).toEqual(['input.zip', 'payload'])
  },
)
it.each(['caseCollision', 'duplicate'] as const)(
  'rejects %s without overwriting the first entry',
  async (name) => {
    const f = await fixture(name)
    await expect(extractZip(f.path, f.destination, new AbortController().signal)).rejects.toThrow(
      'ARCHIVE_UNSAFE',
    )
    const file = name === 'duplicate' ? 'same.txt' : 'Browser.txt'
    expect(await readFile(join(f.destination, file), 'utf8')).toBe('original')
  },
)
it('settles a cancelled or truncated ZIP before the caller removes its staging directory', async () => {
  const f = await fixture('valid')
  await expect(extractZip(f.path, f.destination, AbortSignal.abort())).rejects.toThrow('CANCELLED')
  expect(await readdir(f.destination)).toEqual([])
  await writeFile(f.path, Buffer.from(zipFixtures.valid, 'base64').subarray(0, 45))
  await expect(extractZip(f.path, f.destination, new AbortController().signal)).rejects.toThrow()
  await rm(f.destination, { recursive: true })
})
