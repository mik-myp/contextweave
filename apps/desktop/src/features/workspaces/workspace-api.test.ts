// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkspaceApi } from './workspace-api'
const a = { workspaceId: '00000000-0000-4000-8000-000000000001' }
const b = { workspaceId: '00000000-0000-4000-8000-000000000002' }
afterEach(() => vi.unstubAllGlobals())
it('copies ownership once and never resolves a later selection for queued work or cancellation', async () => {
  const current = vi.fn().mockResolvedValue({ ok: true, data: b }),
    start = vi.fn().mockResolvedValue({ ok: true, data: {} }),
    cancel = vi.fn().mockResolvedValue({ ok: true, data: true })
  vi.stubGlobal('contextweave', {
    workspace: { current },
    environment: { start },
    worker: { cancel },
  })
  const input = { ...a },
    first = createWorkspaceApi(input),
    second = createWorkspaceApi(b)
  input.workspaceId = b.workspaceId
  await first.environment.start('same-id')
  await second.environment.start('same-id')
  await first.worker.cancel('same-task')
  expect(start.mock.calls).toEqual([
    [a, 'same-id'],
    [b, 'same-id'],
  ])
  expect(cancel).toHaveBeenCalledWith(a, 'same-task')
  expect(current).not.toHaveBeenCalled()
})
it('rejects missing, extra and malformed scope before exposing a client', () => {
  expect(() => createWorkspaceApi({ workspaceId: 'bad' })).toThrow()
  const extended = { ...a, extra: true }
  expect(() => createWorkspaceApi(extended)).toThrow()
})

it('keeps every queued item in a running batch under its creation-time owner', async () => {
  const { runBatch } = await import('@/shared/lib/batch')
  let finish!: (value: { ok: true; data: true }) => void
  const start = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue({ ok: true, data: true })
  const current = vi.fn().mockResolvedValue({ ok: true, data: b })
  vi.stubGlobal('contextweave', { workspace: { current }, environment: { start } })
  const original = createWorkspaceApi(a)
  const request = runBatch({
    items: ['same-id', 'next-id'],
    getId: (id) => id,
    getLabel: (id) => id,
    action: (id) => original.environment.start(id),
  })
  const other = createWorkspaceApi(b)
  await other.environment.start('other-id')
  finish({ ok: true, data: true })
  expect(await request).toEqual({ succeeded: ['same-id', 'next-id'], failures: [] })
  expect(start.mock.calls).toEqual([
    [a, 'same-id'],
    [b, 'other-id'],
    [a, 'next-id'],
  ])
  expect(current).not.toHaveBeenCalled()
})
