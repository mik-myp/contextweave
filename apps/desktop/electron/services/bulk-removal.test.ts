import { expect, it, vi } from 'vitest'
import { removeItems } from './bulk-removal'
it('retains per-item failures, continues after a guarded refusal, and never leaks raw exception text', async () => {
  const remove = vi.fn(async (id: string) => {
    if (id === 'busy') return { ok: false as const, code: 'KERNEL_IN_USE', message: '/private' }
    if (id === 'broken') throw new Error('/private/secret')
    return { ok: true as const, data: true }
  })
  expect(await removeItems(['one', 'busy', 'broken', 'two'], (id) => id, remove)).toEqual([
    { id: 'one', ok: true },
    { id: 'busy', ok: false, code: 'KERNEL_IN_USE' },
    { id: 'broken', ok: false, code: 'COMMAND_FAILED' },
    { id: 'two', ok: true },
  ])
  expect(remove.mock.calls.map(([id]) => id)).toEqual(['one', 'busy', 'broken', 'two'])
})
