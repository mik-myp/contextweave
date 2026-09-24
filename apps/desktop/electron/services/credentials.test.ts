import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCredentialStore } from './credentials'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    writeFileSync: vi.fn(fs.writeFileSync),
    renameSync: vi.fn(fs.renameSync),
    fsyncSync: vi.fn(fs.fsyncSync),
    rmSync: vi.fn(fs.rmSync),
  }
})
vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof import('node:crypto')>()
  return { ...crypto, randomUUID: vi.fn(crypto.randomUUID) }
})
const directories: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-vault-'))
  directories.push(root)
  const file = join(root, 'credentials.json')
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  }
  const store = createCredentialStore(file, secure)
  store.save('old', 'old-secret')
  return { root, file, store, secure }
}
describe('atomic credential file', () => {
  it.each(['write', 'flush', 'rename'] as const)(
    'preserves the original file and removes temporary output on %s failure',
    (phase) => {
      const { root, file, store } = fixture()
      const before = readFileSync(file)
      const fail = () => {
        throw new Error('injected disk failure')
      }
      if (phase === 'write') vi.mocked(writeFileSync).mockImplementationOnce(fail)
      if (phase === 'flush') vi.mocked(fsyncSync).mockImplementationOnce(fail)
      if (phase === 'rename') vi.mocked(renameSync).mockImplementationOnce(fail)
      expect(() => store.save('new', 'new-secret')).toThrow('injected disk failure')
      expect(readFileSync(file)).toEqual(before)
      expect(readdirSync(root)).toEqual(['credentials.json'])
      expect(store.read('old')).toBe('old-secret')
      store.save('new', 'new-secret')
      expect(store.read('new')).toBe('new-secret')
    },
  )
  it('leaves a failed cleanup for maintenance without masking the write error', () => {
    const { root, store } = fixture()
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('rename failed')
    })
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw new Error('cleanup failed')
    })
    expect(() => store.save('new', 'secret')).toThrow('rename failed')
    expect(readdirSync(root)).toHaveLength(2)
    store.cleanupTemporaryFiles()
    expect(readdirSync(root)).toEqual(['credentials.json'])
  })
  it('does not remove someone else’s file after an exclusive-create collision', () => {
    const { file, store } = fixture()
    const id = '00000000-0000-4000-8000-000000000001'
    const collision = `${file}.${id}.tmp`
    writeFileSync(collision, 'not ours')
    vi.mocked(randomUUID).mockReturnValueOnce(id)
    expect(() => store.save('new', 'secret')).toThrow()
    expect(readFileSync(collision, 'utf8')).toBe('not ours')
  })
  it('cleans only owned temporary filenames and keeps the vault and unrelated files', () => {
    const { root, file, store } = fixture()
    const stale = `${file}.00000000-0000-4000-8000-000000000001.tmp`
    writeFileSync(stale, 'stale')
    for (const name of [
      'other.tmp',
      'credentials.json.backup.tmp',
      'unrelated.json.00000000-0000-4000-8000-000000000001.tmp',
    ])
      writeFileSync(join(root, name), 'keep')
    store.cleanupTemporaryFiles()
    expect(readdirSync(root).sort()).toEqual([
      'credentials.json',
      'credentials.json.backup.tmp',
      'other.tmp',
      'unrelated.json.00000000-0000-4000-8000-000000000001.tmp',
    ])
    expect(store.read('old')).toBe('old-secret')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })
  it.each(['{broken', '[]', '{"ref":123}'])('does not replace an unreadable vault: %s', (raw) => {
    const { file, store } = fixture()
    writeFileSync(file, raw)
    expect(() => store.save('new', 'secret')).toThrow('CREDENTIAL_STORE_UNREADABLE')
    expect(() => store.remove('old')).toThrow('CREDENTIAL_STORE_UNREADABLE')
    expect(readFileSync(file, 'utf8')).toBe(raw)
  })
})
