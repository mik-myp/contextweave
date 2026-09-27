import { expect, it } from 'vitest'
import { createDraftStore, draftKey } from './draft-storage'
import { environmentFormDefaults } from './environment-form'
const a = { workspaceId: '00000000-0000-4000-8000-000000000001' },
  b = { workspaceId: '00000000-0000-4000-8000-000000000002' }
const defaults = environmentFormDefaults(),
  draft = { defaults, values: { ...defaults, name: 'unsaved' }, revision: 3 }
function memory() {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}
it('restores incomplete non-secret form input and original revision in only its owning space', () => {
  const storage = memory()
  createDraftStore(a, storage).set('same-id', draft)
  expect(createDraftStore(a, storage).get('same-id')).toEqual(draft)
  expect(createDraftStore(b, storage).size).toBe(0)
  createDraftStore(b, storage).set('same-id', { ...draft, values: { ...defaults, name: 'other' } })
  expect(createDraftStore(a, storage).get('same-id')?.values.name).toBe('unsaved')
  createDraftStore(a, storage).delete('same-id')
  expect(createDraftStore(a, storage).size).toBe(0)
  expect(createDraftStore(b, storage).get('same-id')?.values.name).toBe('other')
})
it('claims legacy drafts once under only the verified original default owner and preserves their source', () => {
  const storage = memory()
  storage.setItem('contextweave:environment-drafts:v1', JSON.stringify([['same-id', draft]]))
  expect(createDraftStore(b, storage, a.workspaceId).size).toBe(0)
  expect(createDraftStore(a, storage, a.workspaceId).get('same-id')).toEqual(draft)
  expect(createDraftStore(b, storage, b.workspaceId).size).toBe(0)
  expect(storage.getItem('contextweave:environment-drafts:v1')).toContain('unsaved')
  const first = createDraftStore(a, storage, a.workspaceId)
  first.clear()
  expect(createDraftStore(a, storage, a.workspaceId).size).toBe(0)
})
it('rejects mixed ownership, secrets, malformed snapshots and missing scope', () => {
  const storage = memory()
  storage.setItem(draftKey(b), JSON.stringify({ version: 2, ...a, entries: [['same-id', draft]] }))
  expect(createDraftStore(b, storage).size).toBe(0)
  storage.setItem(draftKey(a), '{broken')
  expect(createDraftStore(a, storage).size).toBe(0)
  const bad = { ...draft, values: { ...draft.values, password: 'secret' } }
  expect(() => createDraftStore(a, storage).set('same-id', bad)).toThrow()
  expect(() => createDraftStore({ workspaceId: 'invalid' }, storage)).toThrow()
})
it('keeps at most 30 drafts and permits editing when storage is denied or full', () => {
  const storage = memory(),
    store = createDraftStore(a, storage)
  for (let i = 0; i < 32; i++) store.set(`env-${i}`, draft)
  expect(store.size).toBe(30)
  expect(store.has('env-0')).toBe(false)
  expect(createDraftStore(a, storage).size).toBe(30)
  const unavailable = createDraftStore(a, {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('full')
    },
  })
  unavailable.set('edit', draft)
  expect(unavailable.get('edit')).toEqual(draft)
})

it('keeps temporarily empty numeric input editable and restores it without allowing secrets', () => {
  const storage = memory()
  const store = createDraftStore(a, storage)
  // React Hook Form valueAsNumber yields NaN when the user clears a numeric field.
  store.set('incomplete', { ...draft, values: { ...draft.values, width: NaN } })
  expect(Number.isNaN(store.get('incomplete')?.values.width)).toBe(true)
  expect(Number.isNaN(createDraftStore(a, storage).get('incomplete')?.values.width)).toBe(true)
  expect(createDraftStore(a, storage).get('incomplete')?.defaults.width).toBe(defaults.width)
})
