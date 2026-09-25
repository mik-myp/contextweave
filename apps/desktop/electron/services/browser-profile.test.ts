import {
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareBrowserProfile } from '../browser-settings'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync), fsyncSync: vi.fn(actual.fsyncSync) }
})
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) }
})
const roots: string[] = []
function fixture(contents = '{"browser":{"check_default_browser":false}}') {
  const root = mkdtempSync(join(tmpdir(), 'cw-profile-'))
  roots.push(root)
  const profile = join(root, 'Default')
  mkdirSync(profile)
  const path = join(profile, 'Preferences')
  writeFileSync(path, contents)
  return { root, profile, path, original: readFileSync(path) }
}
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('browser Preferences safety', () => {
  it('creates a new profile while keeping the temporary namespace empty', () => {
    const f = fixture()
    const root = join(f.root, 'fresh')
    prepareBrowserProfile(root, 'system')
    const profile = join(root, 'Default')
    expect(readdirSync(profile)).toEqual(['Preferences'])
    expect(JSON.parse(readFileSync(join(profile, 'Preferences'), 'utf8'))).toMatchObject({
      intl: {},
      session: { restore_on_startup: 1 },
    })
  })
  it('preserves invalid UTF-8 instead of silently replacing bytes', () => {
    const f = fixture()
    const bytes = Buffer.concat([Buffer.from('{"value":"'), Buffer.from([0xff]), Buffer.from('"}')])
    writeFileSync(f.path, bytes)
    expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PREFERENCES_INVALID$/)
    expect(readFileSync(f.path).equals(bytes)).toBe(true)
  })
  it('does not write an oversized result from a valid near-limit input', () => {
    const f = fixture(JSON.stringify({ padding: 'a'.repeat(16 * 1024 * 1024 - 32) }))
    expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PREFERENCES_TOO_LARGE$/)
    expect(readFileSync(f.path).equals(f.original)).toBe(true)
    expect(readdirSync(f.profile)).toEqual(['Preferences'])
  })
  it.skipIf(process.platform === 'win32')(
    'rejects a dangling preferences symlink without replacing the link',
    () => {
      const f = fixture()
      rmSync(f.path)
      symlinkSync(join(f.root, 'missing-preferences'), f.path)
      expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PROFILE_UNSAFE$/)
      expect(readdirSync(f.profile)).toEqual(['Preferences'])
    },
  )
  it.each(['{"secret":"fixture-private"', '[]', '{"session":"invalid"}'])(
    'preserves corrupt or unsupported preferences: %s',
    (value) => {
      const f = fixture(value)
      expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PREFERENCES_INVALID$/)
      expect(readFileSync(f.path).equals(f.original)).toBe(true)
      expect(readdirSync(f.profile)).toEqual(['Preferences'])
    },
  )
  it('rejects an oversized file without replacing or reading it into a JSON object', () => {
    const f = fixture()
    truncateSync(f.path, 16 * 1024 * 1024 + 1)
    expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PREFERENCES_TOO_LARGE$/)
    expect(readdirSync(f.profile)).toEqual(['Preferences'])
  })
  it('does not reuse an existing fixed-name temporary file', () => {
    const f = fixture()
    const oldTemporary = `${f.path}.contextweave-tmp`
    writeFileSync(oldTemporary, 'unrelated residual data')
    prepareBrowserProfile(f.root, 'ja-JP', true)
    expect(readFileSync(oldTemporary, 'utf8')).toBe('unrelated residual data')
    expect(JSON.parse(readFileSync(f.path, 'utf8'))).toMatchObject({
      browser: { check_default_browser: false },
      intl: { accept_languages: 'ja-JP,ja' },
      session: { restore_on_startup: 1 },
      background_mode: { enabled: false },
      network_prediction_options: 2,
    })
    expect(fsyncSync).toHaveBeenCalled()
  })
  it('retains the original and cleans only the created temporary after a rename failure', () => {
    const f = fixture()
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('fixture rename denied')
    })
    expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PROFILE_IO_FAILED$/)
    expect(readFileSync(f.path).equals(f.original)).toBe(true)
    expect(readdirSync(f.profile)).toEqual(['Preferences'])
    prepareBrowserProfile(f.root, 'en-US')
    expect(JSON.parse(readFileSync(f.path, 'utf8')).intl.accept_languages).toBe('en-US,en')
  })
  it('does not publish partial data after a write synchronization failure', () => {
    const f = fixture()
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw new Error('fixture fsync failed')
    })
    expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PROFILE_IO_FAILED$/)
    expect(readFileSync(f.path).equals(f.original)).toBe(true)
    expect(readdirSync(f.profile)).toEqual(['Preferences'])
  })
  it('does not delete a temporary name it failed to exclusively create', () => {
    const f = fixture()
    const uuid = '00000000-0000-0000-0000-000000000001'
    vi.mocked(randomUUID).mockReturnValueOnce(uuid)
    const collision = `${f.path}.contextweave-${uuid}.tmp`
    writeFileSync(collision, 'not owned by this attempt')
    expect(() => prepareBrowserProfile(f.root, 'en-US')).toThrow(/^BROWSER_PROFILE_IO_FAILED$/)
    expect(readFileSync(collision, 'utf8')).toBe('not owned by this attempt')
    expect(readFileSync(f.path).equals(f.original)).toBe(true)
  })
  it('rejects a linked Default directory without writing through it', () => {
    const f = fixture()
    const linkedRoot = join(f.root, 'linked-environment')
    mkdirSync(linkedRoot)
    symlinkSync(
      f.profile,
      join(linkedRoot, 'Default'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(() => prepareBrowserProfile(linkedRoot, 'en-US')).toThrow(/^BROWSER_PROFILE_UNSAFE$/)
    expect(readFileSync(f.path).equals(f.original)).toBe(true)
  })
  it('rejects automatic language before creating a profile', () => {
    const f = fixture()
    const emptyRoot = join(f.root, 'empty')
    expect(() => prepareBrowserProfile(emptyRoot, 'auto')).toThrow('IP_LOCALE_FAILED')
    expect(existsSync(emptyRoot)).toBe(false)
  })
})
