// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  BatchPreview,
  BatchTask,
  IpcResult,
  BatchPage,
  BatchPageInput,
} from '@contextweave/contracts'
import { batchSummarySchema } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { workspaceKey } from '@/features/workspaces/workspace-session-context'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { fixtureWorkspace, withWorkspaceFixture } from '../../../../test-support/workspace'
import { BatchPreviewDialog } from './batch-preview-dialog'
import { BatchTasks } from './batch-tasks'
const id = '00000000-0000-4000-8000-000000000010',
  time = '2026-01-01T00:00:00.000Z'
const preview: BatchPreview = {
  ...fixtureWorkspace,
  id,
  action: 'start',
  sourceTaskId: null,
  createdAt: time,
  expiresAt: '2026-01-01T00:05:00.000Z',
  targets: [
    { environmentId: 'env-a', name: 'Selected environment', revision: 1, reason: null },
    { environmentId: 'missing', name: '', revision: null, reason: 'NOT_FOUND' },
  ],
}
let task: BatchTask, root: Root, client: QueryClient, container: HTMLDivElement
const readPage = vi.fn<(query: BatchPageInput) => Promise<IpcResult<BatchPage>>>()
const createPreview = vi.fn(),
  confirm = vi.fn(),
  cancel = vi.fn(),
  retry = vi.fn(),
  onClose = vi.fn(),
  onCreated = vi.fn()
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
async function render(element: React.ReactNode) {
  await act(async () =>
    root.render(
      <StrictMode>
        <I18nProvider>
          <QueryClientProvider client={client}>
            <TestWorkspaceProvider>{element}</TestWorkspaceProvider>
          </QueryClientProvider>
        </I18nProvider>
      </StrictMode>,
    ),
  )
  await flush()
}
function button(label: string) {
  const target = [...document.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  )
  if (!target) throw new Error(`Missing ${label}`)
  return target
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  task = {
    ...fixtureWorkspace,
    id,
    action: 'start',
    status: 'running',
    sourceTaskId: null,
    createdAt: time,
    endedAt: null,
    total: 2,
    counts: {
      queued: 1,
      running: 1,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      unknown: 0,
    },
    items: [
      {
        environmentId: 'env-a',
        name: 'Selected environment',
        revision: 1,
        ordinal: 0,
        status: 'running',
        reason: null,
        startedAt: time,
        endedAt: null,
      },
      {
        environmentId: 'env-b',
        name: 'Second',
        revision: 1,
        ordinal: 1,
        status: 'queued',
        reason: null,
        startedAt: null,
        endedAt: null,
      },
    ],
  }
  readPage.mockReset().mockImplementation(async () => {
    // The page summary intentionally omits task details, just like the real boundary.
    const summary = batchSummarySchema.parse(
      Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'items')),
    )
    return { ok: true, data: { ...fixtureWorkspace, items: [summary], nextCursor: null } }
  })
  createPreview.mockResolvedValue({ ok: true, data: preview })
  confirm.mockResolvedValue({ ok: true, data: task })
  cancel.mockResolvedValue({ ok: true, data: task })
  retry.mockResolvedValue({ ok: true, data: { ...preview, sourceTaskId: id } })
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      batch: {
        preview: createPreview,
        confirm,
        cancel,
        retryPreview: retry,
        page: readPage,
        get: async () => ({ ok: true, data: task }),
      },
    }),
  )
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
it('does not create a new preview on focus, query invalidation, StrictMode or later selection changes', async () => {
  const request = { action: 'start' as const, environmentIds: ['env-a', 'missing'] }
  await render(<BatchPreviewDialog request={request} onClose={onClose} onCreated={onCreated} />)
  expect(createPreview).toHaveBeenCalledExactlyOnceWith(request)
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    await client.invalidateQueries({ queryKey: workspaceKey(fixtureWorkspace) })
  })
  await render(
    <BatchPreviewDialog
      request={{ action: 'start', environmentIds: ['other'] }}
      onClose={onClose}
      onCreated={onCreated}
    />,
  )
  expect(createPreview).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain('Selected environment')
  expect(document.body.textContent).toContain('1 / 2 项可提交')
  await act(async () => button('确认并在后台执行').click())
  expect(confirm).toHaveBeenCalledExactlyOnceWith(id)
  expect(onCreated).toHaveBeenCalledWith(id)
})
it('preserves preview on failed confirmation and prevents duplicate submissions', async () => {
  let resolve!: (value: IpcResult<BatchTask>) => void
  confirm.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await render(
    <BatchPreviewDialog
      request={{ action: 'start', environmentIds: ['env-a', 'missing'] }}
      onClose={onClose}
      onCreated={onCreated}
    />,
  )
  await act(async () => {
    button('确认并在后台执行').click()
    button('确认并在后台执行').click()
  })
  expect(confirm).toHaveBeenCalledTimes(1)
  await act(async () =>
    resolve({
      ok: false,
      code: 'BATCH_PREVIEW_EXPIRED',
      message: 'Do not render raw backend message',
    }),
  )
  await flush()
  expect(document.body.textContent).toContain('超过 5 分钟')
  expect(document.body.textContent).toContain('Selected environment')
  expect(document.body.textContent).not.toContain('raw backend')
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => button('重新预览').click())
  await flush()
  expect(createPreview).toHaveBeenCalledTimes(2)
})
it('does not navigate a new page after the submitting dialog was unmounted', async () => {
  let resolve!: (value: IpcResult<BatchTask>) => void
  confirm.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await render(
    <BatchPreviewDialog
      request={{ action: 'start', environmentIds: ['env-a'] }}
      onClose={onClose}
      onCreated={onCreated}
    />,
  )
  await act(async () => button('确认并在后台执行').click())
  await render(<p>Another page</p>)
  await act(async () => resolve({ ok: true, data: task }))
  expect(onCreated).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Another page')
})
it('queries durable task results again after page navigation and exposes cancellation without losing detail', async () => {
  await render(<BatchTasks selectedId={id} onSelect={onCreated} />)
  await flush()
  expect(document.body.textContent).toContain('正在启动')
  await act(async () => button('取消未开始项').click())
  expect(cancel).toHaveBeenCalledExactlyOnceWith(id)
  await render(<p>Another page</p>)
  task = {
    ...task,
    status: 'cancelled',
    endedAt: time,
    counts: { ...task.counts, running: 0, queued: 0, succeeded: 1, cancelled: 1 },
    items: [
      { ...task.items[0]!, status: 'succeeded', endedAt: time },
      { ...task.items[1]!, status: 'cancelled', reason: 'CANCELLED', endedAt: time },
    ],
  }
  await act(async () => {
    await client.invalidateQueries({ queryKey: workspaceKey(fixtureWorkspace, 'batches') })
  })
  await render(<BatchTasks selectedId={id} onSelect={onCreated} />)
  await flush()
  expect(document.body.textContent).toContain('已取消')
  expect(document.body.textContent).toContain('成功 1')
  expect(
    [...document.querySelectorAll('button')].some((b) => b.textContent === '仅重试失败项'),
  ).toBe(false)
})
it('asks for a failed-only retry preview instead of resubmitting all original IDs', async () => {
  task = {
    ...task,
    status: 'completed',
    endedAt: time,
    counts: { ...task.counts, running: 0, queued: 0, failed: 1, succeeded: 1 },
    items: [
      { ...task.items[0]!, status: 'failed', reason: 'KERNEL_UNAVAILABLE', endedAt: time },
      { ...task.items[1]!, status: 'succeeded', startedAt: time, endedAt: time },
    ],
  }
  await render(<BatchTasks selectedId={id} onSelect={onCreated} />)
  await flush()
  await act(async () => button('仅重试失败项').click())
  await flush()
  expect(retry).toHaveBeenCalledExactlyOnceWith(id)
  expect(confirm).not.toHaveBeenCalled()
  expect(createPreview).not.toHaveBeenCalled()
})

it('uses shared controls without losing owned batch cursors, fixed bounds, or loading guards', async () => {
  const olderId = '00000000-0000-4000-8000-000000000011'
  readPage.mockImplementation(async ({ beforeId }) => ({
    ok: true,
    data: {
      ...fixtureWorkspace,
      items: [{ ...task, id: beforeId ? olderId : id }],
      nextCursor: beforeId ? null : id,
    },
  }))
  await render(<BatchTasks onSelect={onCreated} />)
  expect(readPage).toHaveBeenCalledWith({ beforeId: null, limit: 20 })
  expect(container.querySelector('[data-slot="data-table-pagination"]')).not.toBeNull()
  expect(container.querySelectorAll('nav button')).toHaveLength(2)
  expect(container.querySelector('[role="combobox"]')).toBeNull()
  expect(container.querySelector('[aria-current="page"]')).toBeNull()
  expect(button('上一页').disabled).toBe(true)
  let resolve!: (page: IpcResult<BatchPage>) => void
  readPage.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await act(async () => button('下一页').click())
  await flush()
  expect(readPage).toHaveBeenLastCalledWith({ beforeId: id, limit: 20 })
  expect(button('上一页').disabled).toBe(true)
  expect(button('下一页').disabled).toBe(true)
  const calls = readPage.mock.calls.length
  await act(async () => button('下一页').click())
  expect(readPage).toHaveBeenCalledTimes(calls)
  await act(async () =>
    resolve({
      ok: true,
      data: { ...fixtureWorkspace, items: [{ ...task, id: olderId }], nextCursor: null },
    }),
  )
  await flush()
  expect(container.textContent).toContain(olderId)
  expect(button('下一页').disabled).toBe(true)
  expect(button('上一页').disabled).toBe(false)
  await act(async () => button('上一页').click())
  await flush()
  expect(container.textContent).not.toContain(olderId)
  expect(container.textContent).toContain(id)
  expect(button('上一页').disabled).toBe(true)
  expect(button('下一页').disabled).toBe(false)
})

it('does not advance a failed batch page through the shared pagination controls', async () => {
  readPage.mockResolvedValue({ ok: false, code: 'COMMAND_FAILED', message: 'failed' })
  await render(<BatchTasks onSelect={onCreated} />)
  expect(button('上一页').disabled).toBe(true)
  expect(button('下一页').disabled).toBe(true)
  const calls = readPage.mock.calls.length
  await act(async () => button('下一页').click())
  expect(readPage).toHaveBeenCalledTimes(calls)
})
