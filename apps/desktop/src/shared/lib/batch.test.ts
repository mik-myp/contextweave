import { expect, it, vi } from 'vitest'
import { runBatch } from './batch'
it('continues after a rejected mutation and retains only failed identifiers for retry', async () => {
  const progress = vi.fn()
  const action = vi.fn(async (id: string) => {
    if (id === 'locked') throw new Error('In use')
  })
  const result = await runBatch({
    items: ['a', 'locked', 'b'],
    getId: (id) => id,
    getLabel: (id) => id,
    action,
    onProgress: progress,
  })
  expect(result.succeeded).toEqual(['a', 'b'])
  expect(result.failures).toEqual([{ id: 'locked', label: 'locked', message: 'In use' }])
  expect(progress.mock.calls).toEqual([[1], [2], [3]])
})
