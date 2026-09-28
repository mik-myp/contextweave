import { describe, expect, it } from 'vitest'
import {
  bookmarkSchema,
  defaultBookmarkListSchema,
  defaultBookmarksSchema,
  saveDefaultBookmarksSchema,
} from './bookmarks'
const item = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Example',
  url: 'https://example.test/',
}
describe('default bookmark contracts', () => {
  it.each([
    'https://example.test/path?q=one#two',
    'http://localhost:8080/',
    'https://例子.测试/',
    'HTTP://example.test',
  ])('accepts an HTTP(S) bookmark %s', (url) => {
    expect(bookmarkSchema.parse({ ...item, name: ' Example ', url: ` ${url} ` })).toEqual({
      ...item,
      url,
    })
  })
  it.each([
    'https://user:pass@example.test',
    'http://user@example.test',
    'https://@example.test',
    'https://:secret@example.test',
    'ftp://example.test',
    'file:///tmp/test',
    'javascript:alert(1)',
    'data:text/plain,hi',
    '//example.test',
    'example.test',
    'https:/example.test',
    'https://example.test/\npath',
    'https://example.test/a b',
    'https://example.test\\path',
    'https://',
    'https://user%40example.test',
  ])('rejects unsafe or malformed URLs %s', (url) => {
    expect(bookmarkSchema.safeParse({ ...item, url }).success).toBe(false)
  })
  it('rejects unknown fields, empty/long names, oversized templates and duplicate identities', () => {
    for (const patch of [
      { id: '../escape' },
      { name: ' ' },
      { name: 'x'.repeat(121) },
      { url: 'https://example.test/' + 'x'.repeat(4096) },
      { path: '/tmp/profile' },
    ])
      expect(bookmarkSchema.safeParse({ ...item, ...patch }).success).toBe(false)
    expect(defaultBookmarkListSchema.safeParse([item, item]).success).toBe(false)
    expect(
      defaultBookmarkListSchema.safeParse(
        Array.from({ length: 201 }, (_, i) => ({
          ...item,
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
      ).success,
    ).toBe(false)
    expect(defaultBookmarkListSchema.parse([])).toEqual([])
  })
  it('keeps order and requires an explicit revision and response workspace', () => {
    const second = { ...item, id: '00000000-0000-4000-8000-000000000002' }
    expect(
      saveDefaultBookmarksSchema.parse({ expectedRevision: 0, items: [second, item] }).items,
    ).toEqual([second, item])
    expect(saveDefaultBookmarksSchema.safeParse({ items: [] }).success).toBe(false)
    expect(
      saveDefaultBookmarksSchema.safeParse({ expectedRevision: 0, items: [], workspaceId: item.id })
        .success,
    ).toBe(false)
    expect(defaultBookmarksSchema.safeParse({ revision: 0, items: [] }).success).toBe(false)
  })
})
