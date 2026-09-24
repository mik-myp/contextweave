import { mkdtempSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalDatabase } from './index'
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
describe('startup data safety', () => {
  it('does not replace a damaged database and releases its handle after failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-corrupt-')); directories.push(root)
    const file = join(root, 'data.sqlite')
    const original = Buffer.from('damaged database - keep the only original copy')
    writeFileSync(file, original)
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(() => openLocalDatabase(file)).toThrow()
      expect(readFileSync(file)).toEqual(original)
      expect(readdirSync(root)).toEqual(['data.sqlite'])
    }
    // On Windows, renaming also exercises that the failed open left no live SQLite handle.
    renameSync(file, join(root, 'preserved.sqlite'))
    expect(readFileSync(join(root, 'preserved.sqlite'))).toEqual(original)
  })
})
