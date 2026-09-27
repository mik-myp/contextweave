// @vitest-environment jsdom
import { act, useLayoutEffect, useContext, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DataDomain, WorkspaceContext } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { DataTableStateProvider } from '@/components/data-table/data-table-state-provider'
import { DataTableStateContext } from '@/components/data-table/data-table-state-context'
import { EnvironmentDraftProvider } from '@/features/environments/environment-draft-provider'
import { useEnvironmentDrafts } from '@/features/environments/environment-draft-context'
import { environmentFormDefaults } from '@/features/environments/environment-form'
import { useHistoryCleanup } from '@/features/settings/hooks/use-history-cleanup'
import { unwrapIpc } from '@/shared/lib/ipc'
import { WorkspaceSessionProvider } from './workspace-session-provider'
import { useWorkspaceSession, workspaceKey } from './workspace-session-context'
const a = { workspaceId: '00000000-0000-4000-8000-000000000001' },
  b = { workspaceId: '00000000-0000-4000-8000-000000000002' }
let root: Root, container: HTMLDivElement, client: QueryClient
const listeners = new Map<string, (domains: DataDomain[]) => void>()
const list = vi.fn(),
  cancel = vi.fn(),
  preview = vi.fn()
let state: {
  session: ReturnType<typeof useWorkspaceSession>
  drafts: ReturnType<typeof useEnvironmentDrafts>
  snapshots: React.ContextType<typeof DataTableStateContext>
  cleanup: ReturnType<typeof useHistoryCleanup>
}
function Harness() {
  const session = useWorkspaceSession(),
    drafts = useEnvironmentDrafts(),
    snapshots = useContext(DataTableStateContext),
    cleanup = useHistoryCleanup()
  useLayoutEffect(() => {
    state = { session, drafts, snapshots, cleanup }
  })
  const query = useQuery({
    queryKey: workspaceKey(session.context, 'environments', 'list'),
    queryFn: async ({ signal }) => {
      const rows = await unwrapIpc(session.api.environment.list())
      signal.throwIfAborted()
      return rows
    },
  })
  return (
    <output>
      {query.data?.map((row) => row.name).join(',')}|{cleanup.phase}|{cleanup.uncertainId ?? 'none'}
    </output>
  )
}
function Providers({ context, children }: { context: WorkspaceContext; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceSessionProvider context={context}>
        <DataTableStateProvider>
          <EnvironmentDraftProvider>{children}</EnvironmentDraftProvider>
        </DataTableStateProvider>
      </WorkspaceSessionProvider>
    </QueryClientProvider>
  )
}
const flush = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
async function render(context: WorkspaceContext) {
  await act(async () =>
    root.render(
      <I18nProvider>
        <Providers context={context}>
          <Harness />
        </Providers>
      </I18nProvider>,
    ),
  )
  await flush()
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  listeners.clear()
  list.mockReset()
  preview.mockReset()
  cancel.mockReset().mockResolvedValue({ ok: true, data: true })
  vi.stubGlobal('contextweave', {
    environment: { list },
    worker: { cancel },
    storage: {
      getHistoryCleanupReceipt: async () => ({ ok: true, data: null }),
      previewHistoryCleanup: preview,
    },
    events: {
      onDataChanged: (context: WorkspaceContext, listener: (domains: DataDomain[]) => void) => {
        listeners.set(context.workspaceId, listener)
        return () => listeners.delete(context.workspaceId)
      },
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})
it('keeps late same-ID responses, drafts, list snapshots and recovery UI out of the next scope', async () => {
  let finishA!: (value: unknown) => void, finishPreview!: (value: unknown) => void
  list.mockImplementation((context: WorkspaceContext) =>
    context.workspaceId === a.workspaceId
      ? new Promise((done) => {
          finishA = done
        })
      : Promise.resolve({
          ok: true,
          data: [{ workspaceId: b.workspaceId, id: 'same-id', name: 'B-only' }],
        }),
  )
  preview.mockImplementation(
    () =>
      new Promise((done) => {
        finishPreview = done
      }),
  )
  await render(a)
  const firstApi = state.session.api,
    oldSnapshots = state.snapshots,
    defaults = environmentFormDefaults()
  state.drafts.drafts.set('same-id', { defaults, values: { ...defaults, name: 'A private draft' } })
  state.snapshots?.set('environments', { scrollTop: 234, state: { globalFilter: 'A-only' } })
  await act(async () => {
    void state.cleanup.loadPreview()
  })
  expect(state.cleanup.phase).toBe('previewing')
  await render(b)
  expect(container.textContent).toContain('B-only|idle|none')
  expect(state.drafts.drafts.size).toBe(0)
  expect(state.snapshots?.size).toBe(0)
  expect(state.snapshots).not.toBe(oldSnapshots)
  expect([...listeners.keys()]).toEqual([b.workspaceId])
  await act(async () => {
    finishA({ ok: true, data: [{ workspaceId: a.workspaceId, id: 'same-id', name: 'A-private' }] })
    finishPreview({ ok: true, data: { previewId: 'stale-A-preview' } })
  })
  await flush()
  expect(container.textContent).not.toContain('A-private')
  expect(state.cleanup.preview).toBeNull()
  expect(client.getQueryData(workspaceKey(a, 'environments', 'list'))).toBeUndefined()
  expect(client.getQueryData(workspaceKey(b, 'environments', 'list'))).toMatchObject([
    { name: 'B-only' },
  ])
  await firstApi.worker.cancel('owned-task')
  expect(cancel).toHaveBeenCalledWith(a, 'owned-task')
})
it('invalidates only its source namespace and cancels on unmount, not all workspace caches', async () => {
  list.mockResolvedValue({ ok: true, data: [] })
  await render(a)
  client.setQueryData(workspaceKey(b, 'environments', 'list'), ['retained-B-cache'])
  const invalidation = vi.spyOn(client, 'invalidateQueries')
  await act(async () => listeners.get(a.workspaceId)?.(['environments']))
  expect(invalidation).toHaveBeenCalledWith({ queryKey: workspaceKey(a, 'environments') })
  expect(client.getQueryData(workspaceKey(b, 'environments', 'list'))).toEqual(['retained-B-cache'])
  await render(b)
  expect([...listeners.keys()]).toEqual([b.workspaceId])
})
