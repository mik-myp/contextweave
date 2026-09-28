import { expect, it, vi } from 'vitest'
import { openStartupBookmarkTargets } from './startup-bookmarks'
it('reuses restored pages and opens each selected URL once in saved order', async () => {
  const send = vi.fn(async (method: string) =>
    method === 'Target.getTargets'
      ? { targetInfos: [{ type: 'page', url: 'https://one.test/' }] }
      : { targetId: 'new' },
  )
  await openStartupBookmarkTargets(
    ['https://one.test', 'https://two.test', 'https://two.test/'],
    send,
    new AbortController().signal,
  )
  expect(send.mock.calls).toEqual([
    ['Target.getTargets', {}],
    ['Target.createTarget', { url: 'https://two.test/' }],
  ])
})
it('does nothing for legacy opt-out, rejects unsafe URLs before sending, and respects cancellation', async () => {
  const send = vi.fn()
  await openStartupBookmarkTargets([], send, new AbortController().signal)
  expect(send).not.toHaveBeenCalled()
  for (const url of [
    'file:///private',
    'javascript:alert(1)',
    'https://u:p@example.test',
    '--new-window',
  ]) {
    await expect(
      openStartupBookmarkTargets([url], send, new AbortController().signal),
    ).rejects.toThrow()
  }
  const abort = new AbortController()
  abort.abort()
  await expect(
    openStartupBookmarkTargets(['https://one.test'], send, abort.signal),
  ).rejects.toThrow()
  expect(send).not.toHaveBeenCalled()
})
it('stops between URLs if cancelled and does not retry a partially opened list', async () => {
  const abort = new AbortController()
  const send = vi.fn(async (method: string) => {
    if (method === 'Target.getTargets') return { targetInfos: [] }
    abort.abort()
    return { targetId: 'one' }
  })
  await expect(
    openStartupBookmarkTargets(['https://one.test', 'https://two.test'], send, abort.signal),
  ).rejects.toThrow()
  expect(send).toHaveBeenCalledTimes(2)
})

it('rejects a missing target receipt instead of reporting unopened bookmarks as successful', async () => {
  const send = vi.fn(async (method: string) =>
    method === 'Target.getTargets' ? { targetInfos: [] } : {},
  )
  await expect(
    openStartupBookmarkTargets(
      ['https://one.test', 'https://two.test'],
      send,
      new AbortController().signal,
    ),
  ).rejects.toThrow()
  expect(send).toHaveBeenCalledTimes(2)
})
