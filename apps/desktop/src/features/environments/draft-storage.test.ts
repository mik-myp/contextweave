import { expect, it } from 'vitest'
import { createDraftStore } from './draft-storage'
import { environmentFormDefaults } from './environment-form'
it('restores incomplete non-secret form input and the original revision across reloads', () => {
  const memory = new Map<string, string>(),
    storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
    }
  const first = createDraftStore(storage),
    defaults = environmentFormDefaults()
  first.set('env-a', { defaults, values: { ...defaults, name: 'unsaved' }, revision: 3 })
  const second = createDraftStore(storage)
  expect(second.get('env-a')).toMatchObject({ revision: 3, values: { name: 'unsaved' } })
  second.delete('env-a')
  expect(createDraftStore(storage).size).toBe(0)
})
it('discards invalid stored data without breaking the editor', () => {
  expect(createDraftStore({ getItem: () => '{broken', setItem: () => {} }).size).toBe(0)
})
