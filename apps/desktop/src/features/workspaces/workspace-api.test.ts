// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { workspaceApi } from './workspace-api'
const workspace = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  kind: 'personal',
  storageMode: 'local',
  createdAt: '2026-09-27T00:00:00.000Z',
}
afterEach(() => vi.unstubAllGlobals())
it('binds the actual current identity explicitly on every command without creating a mutable selection', async () => {
  const current = vi.fn().mockResolvedValue({ ok: true, data: workspace }),
    list = vi.fn().mockResolvedValue({ ok: true, data: [] })
  vi.stubGlobal('contextweave', { workspace: { current }, environment: { list } })
  await workspaceApi.environment.list()
  expect(list).toHaveBeenCalledWith({ workspaceId: workspace.workspaceId })
  current.mockResolvedValueOnce({ ok: false, code: 'DATABASE_WORKSPACE_INVALID', message: 'safe' })
  expect(await workspaceApi.environment.list()).toMatchObject({
    ok: false,
    code: 'DATABASE_WORKSPACE_INVALID',
  })
  expect(list).toHaveBeenCalledTimes(1)
  current.mockResolvedValueOnce({ ok: true, data: { ...workspace, workspaceId: 'bad' } })
  await expect(workspaceApi.environment.list()).rejects.toThrow()
  expect(list).toHaveBeenCalledTimes(1)
})
