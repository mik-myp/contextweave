import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BookmarkSettingsRepository, EnvironmentRepository, openLocalDatabase } from './index'
const cleanup: (() => void)[] = []
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
)
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-bookmark-settings-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  cleanup.push(() => db.close())
  const repository = new EnvironmentRepository(db.sqlite)
  return { db, repository, bookmarks: new BookmarkSettingsRepository(repository) }
}
const one = { id: '00000000-0000-4000-8000-000000000001', name: 'One', url: 'https://one.test/' }
const two = { ...one, id: '00000000-0000-4000-8000-000000000002', name: 'Two' }
it('starts empty without writing settings; persists ordered CRUD with no schema changes', () => {
  const { db, repository, bookmarks } = fixture()
  const schema = db.sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()
  expect(bookmarks.get()).toEqual({ ...repository.context, revision: 0, items: [] })
  expect(repository.getSetting('bookmarks:defaults:v1')).toBeUndefined()
  bookmarks.save({ expectedRevision: 0, items: [one, two] })
  bookmarks.save({ expectedRevision: 1, items: [{ ...two, name: 'Edited' }, one] })
  expect(new BookmarkSettingsRepository(repository).get().items).toEqual([
    { ...two, name: 'Edited' },
    one,
  ])
  expect(bookmarks.save({ expectedRevision: 2, items: [] }).revision).toBe(3)
  expect(db.sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()).toEqual(schema)
})
it('rejects stale edits, invalid payloads and never overwrites the last saved template', () => {
  const { bookmarks } = fixture()
  const saved = bookmarks.save({ expectedRevision: 0, items: [one] })
  expect(() => bookmarks.save({ expectedRevision: 0, items: [] })).toThrow('BOOKMARKS_CONFLICT')
  expect(() =>
    bookmarks.save({ expectedRevision: 1, items: [{ ...one, url: 'https://u:p@one.test' }] }),
  ).toThrow()
  expect(bookmarks.get()).toEqual(saved)
})
it('isolates workspaces even when bookmark identities match', () => {
  const a = fixture(),
    b = fixture()
  a.bookmarks.save({ expectedRevision: 0, items: [one] })
  expect(b.bookmarks.get().items).toEqual([])
  expect(b.bookmarks.get().workspaceId).not.toBe(a.bookmarks.get().workspaceId)
  b.bookmarks.save({ expectedRevision: 0, items: [two] })
  expect(a.bookmarks.get().items).toEqual([one])
})
it.each([null, { items: [] }, { workspaceId: one.id, revision: 1, items: [one] }])(
  'does not silently reset malformed or foreign stored values',
  (value) => {
    const { repository, bookmarks } = fixture()
    repository.setSetting('bookmarks:defaults:v1', value)
    expect(() => bookmarks.get()).toThrow('BOOKMARKS_SETTINGS_INVALID')
    expect(() => bookmarks.save({ expectedRevision: 0, items: [] })).toThrow(
      'BOOKMARKS_SETTINGS_INVALID',
    )
    expect(repository.getSetting('bookmarks:defaults:v1')).toEqual(value)
  },
)
it('keeps per-profile decisions separate from the template and fails closed on bad receipts', () => {
  const { bookmarks, repository } = fixture()
  expect(bookmarks.profileState('env-a')).toBeUndefined()
  bookmarks.setProfileState('env-a', 'pending')
  bookmarks.save({ expectedRevision: 0, items: [one] })
  expect(bookmarks.profileState('env-a')).toBe('pending')
  expect(bookmarks.profileState('env-b')).toBeUndefined()
  repository.setSetting('bookmarks:profile:v1:env-a', {})
  expect(() => bookmarks.profileState('env-a')).toThrow('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
})
