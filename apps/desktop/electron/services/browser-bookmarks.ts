import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { defaultBookmarkListSchema, type Bookmark } from '@contextweave/contracts'
import {
  BookmarkSettingsRepository,
  inspectRuntimeLock,
  type WorkspacePaths,
  type EnvironmentRecord,
  type EnvironmentRepository,
} from '@contextweave/storage'

function statIfPresent(path: string) {
  try {
    return lstatSync(path, { bigint: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Chromium BookmarkCodec v1. No preferences, startup URLs or CDP commands are involved. */
export function encodeDefaultBookmarks(input: Bookmark[]): string {
  const items = defaultBookmarkListSchema.parse(input)
  const now = String((BigInt(Date.now()) + 11644473600000n) * 1000n)
  const md5 = createHash('md5')
  const sha256 = createHash('sha256')
  const checksum = (id: string, name: string, type: 'folder' | 'url', url?: string) => {
    for (const hash of [md5, sha256]) {
      hash.update(id).update(Buffer.from(name, 'utf16le')).update(type)
      if (url !== undefined) hash.update(url)
    }
  }
  const folder = (id: string, name: string, guid: string, bookmarks: Bookmark[] = []) => {
    checksum(id, name, 'folder')
    return {
      id,
      name,
      guid,
      type: 'folder',
      date_added: now,
      date_modified: now,
      children: bookmarks.map((item, index) => {
        const nodeId = String(index + 4)
        const url = new URL(item.url).href
        checksum(nodeId, item.name, 'url', url)
        return {
          id: nodeId,
          name: item.name,
          guid: randomUUID(),
          type: 'url',
          url,
          date_added: now,
          date_last_used: '0',
        }
      }),
    }
  }
  const roots = {
    bookmark_bar: folder('1', 'Bookmarks bar', '00000000-0000-4000-a000-000000000002', items),
    other: folder('2', 'Other bookmarks', '00000000-0000-4000-a000-000000000003'),
    synced: folder('3', 'Mobile bookmarks', '00000000-0000-4000-a000-000000000004'),
  }
  return JSON.stringify({
    version: 1,
    roots,
    checksum: md5.digest('hex'),
    checksum_sha256: sha256.digest('hex'),
  })
}

function seedProfile(options: {
  paths: WorkspacePaths
  record: EnvironmentRecord
  read(): Bookmark[]
  complete(): void
}) {
  const { paths, record, read, complete } = options
  const dataDir = paths.environment(record)
  const profile = join(dataDir, 'Default')
  const target = join(profile, 'Bookmarks')
  const anchors = [paths.root, paths.environments(), dataDir].map((path) => ({
    path,
    stat: lstatSync(path, { bigint: true }),
  }))
  function assertAnchors() {
    paths.environment(record)
    for (const { path, stat } of anchors) {
      const current = lstatSync(path, { bigint: true })
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== stat.dev ||
        current.ino !== stat.ino
      )
        throw new Error('BOOKMARKS_PROFILE_UNSAFE')
    }
  }
  let temporary: string | undefined
  let temporaryStat: ReturnType<typeof statIfPresent>
  let published = false
  let createdProfile = false
  try {
    assertAnchors()
    const directory = statIfPresent(profile)
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
      throw new Error('BOOKMARKS_PROFILE_UNSAFE')
    if (directory) anchors.push({ path: profile, stat: directory })
    const rootEntries = readdirSync(dataDir, { withFileTypes: true })
    const profileEntries = directory ? readdirSync(profile, { withFileTypes: true }) : []
    if ([...rootEntries, ...profileEntries].some((entry) => entry.isSymbolicLink()))
      throw new Error('BOOKMARKS_PROFILE_UNSAFE')
    // Any browser data (including imported/cloned profiles, backups, alternate profiles,
    // Local State, or unknown files) makes this ineligible. Never read or merge it.
    if (
      rootEntries.some((entry) => !['.runtime.lock', 'Default'].includes(entry.name)) ||
      profileEntries.length
    ) {
      complete()
      return
    }
    const items = read()
    if (!items.length) {
      complete() // Persist even an empty template, so later edits cannot backfill a launched profile.
      return
    }
    const content = encodeDefaultBookmarks(items)
    assertAnchors()
    if (!directory) {
      mkdirSync(profile, { mode: 0o700 })
      createdProfile = true
      anchors.push({ path: profile, stat: lstatSync(profile, { bigint: true }) })
    }
    assertAnchors()
    temporary = join(profile, `.contextweave-bookmarks-${randomUUID()}.tmp`)
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      temporaryStat = lstatSync(temporary, { bigint: true })
      const opened = fstatSync(fd, { bigint: true })
      if (
        !temporaryStat.isFile() ||
        temporaryStat.isSymbolicLink() ||
        !opened.isFile() ||
        opened.dev !== temporaryStat.dev ||
        opened.ino !== temporaryStat.ino
      )
        throw new Error('BOOKMARKS_PROFILE_UNSAFE')
      // Opening can follow a concurrently replaced parent. Revalidate before placing any
      // user content in the descriptor; do not try to clean up through a changed anchor.
      // These guards are not an atomic sandbox against another same-user writer.
      assertAnchors()
      writeFileSync(fd, content, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    assertAnchors()
    // Recheck eligibility immediately before publishing; link is atomic and refuses EEXIST.
    if (
      readdirSync(dataDir).some((name) => !['.runtime.lock', 'Default'].includes(name)) ||
      readdirSync(profile).some((name) => join(profile, name) !== temporary)
    )
      throw new Error('BOOKMARKS_PROFILE_CHANGED')
    const source = lstatSync(temporary, { bigint: true })
    if (
      !source.isFile() ||
      source.isSymbolicLink() ||
      source.dev !== temporaryStat.dev ||
      source.ino !== temporaryStat.ino
    )
      throw new Error('BOOKMARKS_PROFILE_UNSAFE')
    linkSync(temporary, target)
    published = true
    assertAnchors()
    const destination = lstatSync(target, { bigint: true })
    if (
      !destination.isFile() ||
      destination.isSymbolicLink() ||
      destination.dev !== temporaryStat.dev ||
      destination.ino !== temporaryStat.ino
    )
      throw new Error('BOOKMARKS_PROFILE_UNSAFE')
    unlinkSync(temporary)
    temporary = undefined
    complete()
  } catch (error) {
    try {
      assertAnchors()
      const removeOwned = (path: string) => {
        const stat = statIfPresent(path)
        if (!stat) return
        if (
          !temporaryStat ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.dev !== temporaryStat.dev ||
          stat.ino !== temporaryStat.ino
        )
          throw new Error('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
        unlinkSync(path)
      }
      if (published) removeOwned(target)
      if (temporary) removeOwned(temporary)
      if (createdProfile) rmdirSync(profile) // Only our empty directory; never recursive deletion.
    } catch {
      throw new Error('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
    }
    if (error instanceof Error && error.message.startsWith('BOOKMARKS_')) throw error
    throw new Error('BOOKMARKS_PROFILE_IO_FAILED', { cause: error })
  }
}

/** Main only: called synchronously after exclusive lock acquisition, before Preferences/spawn. */
export function initializeDefaultBookmarks(
  repository: EnvironmentRepository,
  record: EnvironmentRecord,
  sessionId: string,
  paths: WorkspacePaths,
): void {
  paths.assertDatabase(repository.databasePath)
  paths.environment(record)
  const lock = inspectRuntimeLock(record.dataDir)
  if (lock.owner?.sessionId !== sessionId || lock.owner.pid !== process.pid)
    throw new Error('BOOKMARKS_PROFILE_LOCK_REQUIRED')
  const settings = new BookmarkSettingsRepository(repository)
  const state = settings.profileState(record.environmentId)
  if (state === 'complete') return
  // An interrupted disk/database handoff is ambiguous: fail closed, never overwrite or guess.
  if (state === 'pending') throw new Error('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
  if (state !== 'retry' && state !== 'eligible' && record.status !== 'created') {
    settings.setProfileState(record.environmentId, 'complete')
    return // Legacy running/stopped/recovery profiles are not proven unused, even if emptied.
  }
  settings.setProfileState(record.environmentId, 'pending')
  try {
    seedProfile({
      paths,
      record,
      read: () => settings.get().items,
      complete: () => settings.setProfileState(record.environmentId, 'complete'),
    })
  } catch (error) {
    if (!(error instanceof Error && error.message === 'BOOKMARKS_PROFILE_RECOVERY_REQUIRED')) {
      try {
        settings.setProfileState(record.environmentId, 'retry')
      } catch {
        throw new Error('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
      }
    }
    throw error
  }
}
