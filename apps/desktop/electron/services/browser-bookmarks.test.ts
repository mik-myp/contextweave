import {
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import {
  acquireRuntimeLock,
  BookmarkSettingsRepository,
  EnvironmentRepository,
  openLocalDatabase,
  releaseRuntimeLock,
  WorkspacePaths,
} from '@contextweave/storage'
import { encodeDefaultBookmarks, initializeDefaultBookmarks } from './browser-bookmarks'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    fsyncSync: vi.fn(actual.fsyncSync),
    linkSync: vi.fn(actual.linkSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  }
})
const cleanup: (() => void)[] = []
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(openSync).mockReset().mockImplementation(actual.openSync)
  vi.mocked(fsyncSync).mockReset().mockImplementation(actual.fsyncSync)
  vi.mocked(linkSync).mockReset().mockImplementation(actual.linkSync)
  vi.mocked(unlinkSync).mockReset().mockImplementation(actual.unlinkSync)
  vi.restoreAllMocks()
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn())
})
const one = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '示例',
  url: 'https://example.test/path',
}
const two = {
  ...one,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Second',
  url: 'http://second.test/',
}
function fixture(items = [one, two]) {
  const root = mkdtempSync(join(tmpdir(), 'cw-bookmark-profile-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  cleanup.push(() => db.close())
  const repository = new EnvironmentRepository(db.sqlite)
  const dataDir = join(root, 'environments', 'env-a')
  mkdirSync(dataDir, { recursive: true })
  const record = repository.create({
    config: environmentConfigSchema.parse({
      environmentId: 'env-a',
      name: 'A',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
    }),
    dataDir,
    platform: 'darwin',
    arch: 'arm64',
  })
  const paths = new WorkspacePaths(repository.context, root)
  const settings = new BookmarkSettingsRepository(repository)
  settings.save({ expectedRevision: 0, items })
  const owner = {
    pid: process.pid,
    sessionId: 'bookmarks-session',
    controlPort: 9000,
    startedAt: new Date().toISOString(),
  }
  expect(acquireRuntimeLock(dataDir, owner).acquired).toBe(true)
  const profile = join(dataDir, 'Default')
  return {
    root,
    db,
    repository,
    paths,
    record,
    settings,
    profile,
    target: join(profile, 'Bookmarks'),
    owner,
    initialize: () => initializeDefaultBookmarks(repository, record, owner.sessionId, paths),
  }
}

describe('first-launch default bookmarks', () => {
  it('writes ordered Chromium roots before Preferences, seals once and leaves no temporary files', () => {
    const f = fixture()
    f.initialize()
    const before = readFileSync(f.target)
    expect(JSON.parse(before.toString())).toMatchObject({
      version: 1,
      roots: {
        bookmark_bar: {
          type: 'folder',
          children: [
            { id: '4', name: one.name, url: one.url },
            { id: '5', name: two.name, url: two.url },
          ],
        },
        other: { children: [] },
        synced: { children: [] },
      },
    })
    expect(readdirSync(f.profile)).toEqual(['Bookmarks'])
    expect(existsSync(join(f.profile, 'Preferences'))).toBe(false)
    expect(f.settings.profileState('env-a')).toBe('complete')
    f.settings.save({ expectedRevision: 1, items: [two] })
    f.initialize()
    expect(readFileSync(f.target)).toEqual(before)
  })
  it('seals an empty template without creating browser files, and never backfills later', () => {
    const f = fixture([])
    f.initialize()
    expect(existsSync(f.profile)).toBe(false)
    f.settings.save({ expectedRevision: 1, items: [one] })
    f.initialize()
    expect(existsSync(f.profile)).toBe(false)
    expect(f.settings.profileState('env-a')).toBe('complete')
  })
  it('allows a never-initialized empty Default directory', () => {
    const f = fixture()
    mkdirSync(f.profile)
    f.initialize()
    expect(existsSync(f.target)).toBe(true)
  })
  it.each([
    'Default/Preferences',
    'Default/Bookmarks',
    'Default/Bookmarks.bak',
    'Default/History',
    'Local State',
    'Profile 1/Preferences',
    'import-manifest.json',
  ])('preserves existing/cloned/imported profile data: %s', (file) => {
    const f = fixture()
    const path = join(f.record.dataDir, file)
    mkdirSync(dirname(path), { recursive: true })
    const original = Buffer.from([0xff, 0x00, 0x01])
    writeFileSync(path, original)
    f.initialize()
    expect(readFileSync(path)).toEqual(original)
    if (path !== f.target) expect(existsSync(f.target)).toBe(false)
    expect(f.settings.profileState('env-a')).toBe('complete')
  })
  it.each(['running', 'stopped', 'error', 'needs-recovery'] as const)(
    'does not backfill a legacy %s profile even if its directory was emptied',
    (status) => {
      const f = fixture()
      initializeDefaultBookmarks(f.repository, { ...f.record, status }, f.owner.sessionId, f.paths)
      expect(existsSync(f.profile)).toBe(false)
    },
  )
  it('fails closed after a crash between disk publication and receipt commit', () => {
    const f = fixture()
    f.settings.setProfileState('env-a', 'pending')
    mkdirSync(f.profile)
    writeFileSync(f.target, 'unconfirmed profile data')
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
    expect(readFileSync(f.target, 'utf8')).toBe('unconfirmed profile data')
  })
  it('requires the current Main lock and refuses another session or an unlocked profile', () => {
    const f = fixture()
    expect(() =>
      initializeDefaultBookmarks(f.repository, f.record, 'other-session', f.paths),
    ).toThrow('BOOKMARKS_PROFILE_LOCK_REQUIRED')
    releaseRuntimeLock(f.record.dataDir, f.owner.sessionId)
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_LOCK_REQUIRED')
    expect(existsSync(f.profile)).toBe(false)
    expect(f.settings.profileState('env-a')).toBeUndefined()
  })
})

describe('profile write safety and recovery', () => {
  for (const kind of [
    'profile',
    'bookmarks',
    'preferences',
    'dataDir',
    'environmentRoot',
  ] as const) {
    // File symlinks require Windows privileges; directory junctions remain covered.
    it.skipIf(process.platform === 'win32' && (kind === 'bookmarks' || kind === 'preferences'))(
      `refuses ${kind} symlinks without touching the destination`,
      () => {
        const f = fixture()
        const outside = join(f.root, 'outside')
        mkdirSync(outside)
        const protectedFile = join(outside, 'keep')
        writeFileSync(protectedFile, 'protected')
        if (kind === 'profile') symlinkSync(outside, f.profile, 'junction')
        else if (kind === 'dataDir' || kind === 'environmentRoot') {
          const path = kind === 'dataDir' ? f.record.dataDir : dirname(f.record.dataDir)
          renameSync(path, `${path}-original`)
          symlinkSync(outside, path, 'junction')
        } else {
          mkdirSync(f.profile)
          symlinkSync(
            protectedFile,
            join(f.profile, kind === 'bookmarks' ? 'Bookmarks' : 'Preferences'),
          )
        }
        expect(f.initialize).toThrow(/UNSAFE/)
        expect(readdirSync(outside)).toEqual(['keep'])
        expect(readFileSync(protectedFile, 'utf8')).toBe('protected')
      },
    )
  }
  it('detects a parent replacement during open before writing any bookmark content', async () => {
    const f = fixture()
    const outside = join(f.root, 'outside')
    mkdirSync(outside)
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(openSync).mockImplementationOnce((path, flags, mode) => {
      renameSync(f.profile, `${f.profile}-original`)
      symlinkSync(outside, f.profile, 'junction')
      return actual.openSync(path, flags, mode)
    })
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
    expect(f.settings.profileState('env-a')).toBe('pending')
    // Node cannot atomically anchor openat across supported platforms: a raced open may
    // leave an empty exclusive file. Never write content or delete through the new parent.
    const files = readdirSync(outside)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\.contextweave-bookmarks-.*\.tmp$/)
    expect(readFileSync(join(outside, files[0]!))).toHaveLength(0)
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
  })
  it('rejects a persisted path outside the workspace or a traversal alias', () => {
    const f = fixture()
    for (const dataDir of [f.root, `${f.record.dataDir}/../env-a`]) {
      expect(() =>
        initializeDefaultBookmarks(
          f.repository,
          { ...f.record, dataDir },
          f.owner.sessionId,
          f.paths,
        ),
      ).toThrow('WORKSPACE_PATH_UNSAFE')
    }
    expect(existsSync(f.profile)).toBe(false)
  })
  it.each(['ENOSPC', 'EACCES', 'EIO'])(
    'rolls back a failed durable write (%s) and permits a safe retry',
    (code) => {
      const f = fixture()
      vi.mocked(fsyncSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('disk failure'), { code })
      })
      expect(f.initialize).toThrow('BOOKMARKS_PROFILE_IO_FAILED')
      expect(existsSync(f.profile)).toBe(false)
      expect(f.settings.profileState('env-a')).toBe('retry')
      initializeDefaultBookmarks(
        f.repository,
        { ...f.record, status: 'error' },
        f.owner.sessionId,
        f.paths,
      )
      expect(existsSync(f.target)).toBe(true)
    },
  )
  it('does not overwrite a target that appears at the exclusive publication boundary', async () => {
    const f = fixture()
    mkdirSync(f.profile) // Existing empty directory is not owned by this attempt.
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(linkSync).mockImplementationOnce((source, target) => {
      writeFileSync(target, 'concurrent data')
      actual.linkSync(source, target)
    })
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_IO_FAILED')
    expect(readFileSync(f.target, 'utf8')).toBe('concurrent data')
    expect(readdirSync(f.profile)).toEqual(['Bookmarks'])
  })
  it('undoes its own published file if the completion receipt cannot be saved', () => {
    const f = fixture()
    const set = f.repository.setSetting.bind(f.repository)
    vi.spyOn(f.repository, 'setSetting').mockImplementation((key, value) => {
      if (value === 'complete') throw new Error('disk failure')
      set(key, value)
    })
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_IO_FAILED')
    expect(existsSync(f.profile)).toBe(false)
    expect(f.settings.profileState('env-a')).toBe('retry')
  })
  it('rolls back publication if temporary cleanup fails', () => {
    const f = fixture()
    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw new Error('cleanup failure')
    })
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_IO_FAILED')
    expect(existsSync(f.profile)).toBe(false)
  })
  it('retains an ambiguous receipt and refuses subsequent launch when rollback fails', () => {
    const f = fixture()
    vi.mocked(unlinkSync).mockImplementation(() => {
      throw new Error('cleanup failure')
    })
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
    expect(f.settings.profileState('env-a')).toBe('pending')
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
  })
  it('does not remove a replaced file while attempting rollback', async () => {
    const f = fixture()
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      actual.unlinkSync(f.target)
      writeFileSync(f.target, 'replacement')
      throw new Error('cleanup failure')
    })
    expect(f.initialize).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
    expect(readFileSync(f.target, 'utf8')).toBe('replacement')
  })
  it('does not read a broken template when existing profile data must be preserved', () => {
    const f = fixture()
    mkdirSync(f.profile)
    writeFileSync(f.target, 'existing')
    f.repository.setSetting('bookmarks:defaults:v1', null)
    f.initialize()
    expect(readFileSync(f.target, 'utf8')).toBe('existing')
  })
  it('does not write any file when a template is corrupt', () => {
    const f = fixture()
    f.repository.setSetting('bookmarks:defaults:v1', null)
    expect(f.initialize).toThrow('BOOKMARKS_SETTINGS_INVALID')
    expect(existsSync(f.profile)).toBe(false)
  })
})

it('encodes valid unique ids, timestamps and checksums for Unicode URL nodes', () => {
  const value = JSON.parse(encodeDefaultBookmarks([one, two]))
  expect(value.checksum).toMatch(/^[a-f0-9]{32}$/)
  expect(value.checksum_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(value.roots.bookmark_bar.date_added).toMatch(/^\d+$/)
  expect(value.roots.bookmark_bar.children[0].guid).not.toBe(one.id)
})

it('keeps a proven new profile eligible after an earlier pre-launch failure or cancellation', () => {
  const f = fixture()
  f.settings.setProfileState('env-a', 'eligible')
  initializeDefaultBookmarks(
    f.repository,
    { ...f.record, status: 'error' },
    f.owner.sessionId,
    f.paths,
  )
  expect(existsSync(f.target)).toBe(true)
  expect(f.settings.profileState('env-a')).toBe('complete')
})

it('records unused-profile provenance at creation without writing browser files or reading a template', async () => {
  const { createEnvironmentService } = await import('./environment-service')
  const { createKernelService } = await import('./kernel-service')
  const f = fixture()
  const kernels = createKernelService(f.repository, 'darwin', 'arm64')
  vi.spyOn(kernels, 'hasCompatibleProvider').mockReturnValue(true)
  vi.spyOn(kernels, 'list').mockReturnValue(
    kernels.list().map((kernel) => ({ ...kernel, status: 'available' })),
  )
  f.repository.setSetting('bookmarks:defaults:v1', null)
  const service = createEnvironmentService(
    f.repository,
    kernels,
    f.paths.environments(),
    'darwin',
    'arm64',
  )
  const record = service.create(
    { name: 'New', kernelId: 'standard-chromium', commonConfig: {}, kernelConfig: {} },
    'env-new',
  )
  expect(f.settings.profileState(record.environmentId)).toBe('eligible')
  expect(readdirSync(record.dataDir)).toEqual([])
})
