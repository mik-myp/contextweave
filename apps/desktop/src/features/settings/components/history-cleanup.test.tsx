// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import {
  type HistoryCleanupPreview,
  type HistoryCleanupReceipt,
  type HistoryCleanupResult,
  type IpcResult,
} from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { HistoryCleanup } from './history-cleanup'

const preview: HistoryCleanupPreview = {
  previewId: 'e4c3b366-6342-4630-b533-93ec809bafce',
  retentionDays: 90,
  cutoffAt: '2026-06-29T00:00:00.000Z',
  createdAt: '2026-09-27T00:00:00.000Z',
  expiresAt: '2026-09-27T00:05:00.000Z',
  sessions: { count: 500, hasMore: true },
  operations: { count: 3, hasMore: false },
}
const receipt: HistoryCleanupReceipt = {
  previewId: preview.previewId,
  retentionDays: 90,
  cutoffAt: preview.cutoffAt,
  completedAt: '2026-09-27T00:01:00.000Z',
  sessions: { selected: 500, deleted: 499, skipped: 1 },
  operations: { selected: 3, deleted: 3, skipped: 0 },
}
const previewCall = vi.fn<() => Promise<IpcResult<HistoryCleanupPreview>>>()
const confirmCall = vi.fn<() => Promise<IpcResult<HistoryCleanupResult>>>()
const receiptCall = vi.fn<() => Promise<IpcResult<HistoryCleanupReceipt | null>>>()
let root: Root, container: HTMLDivElement, client: QueryClient
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((node) => node.textContent === text)!
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
async function click(text: string) {
  await act(async () => button(text).click())
  await flush()
}
async function render() {
  await act(async () =>
    root.render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <HistoryCleanup />
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
  await flush()
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('contextweave', {
    storage: {
      previewHistoryCleanup: previewCall,
      confirmHistoryCleanup: confirmCall,
      getHistoryCleanupReceipt: receiptCall,
    },
  })
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  previewCall.mockReset().mockResolvedValue({ ok: true, data: preview })
  confirmCall.mockReset().mockResolvedValue({ ok: true, data: { receipt, replayed: false } })
  receiptCall.mockReset().mockResolvedValue({ ok: true, data: null })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})

it('defaults to 90 days, requires preview plus explicit confirmation, and reports skipped rows without auto-continuing', async () => {
  await render()
  expect(button('90 天').getAttribute('aria-pressed')).toBe('true')
  expect(previewCall).not.toHaveBeenCalled()
  expect(confirmCall).not.toHaveBeenCalled()
  expect(container.textContent).toContain('不会清理浏览器文件')
  await click('预览清理范围')
  expect(previewCall).toHaveBeenCalledExactlyOnceWith({ retentionDays: 90 })
  expect(container.textContent).toContain('500 条会话记录和 3 条操作记录')
  expect(container.textContent).toContain('数量不是全库总数')
  await click('确认本批清理…')
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('此操作不可撤销')
  await click('取消')
  expect(confirmCall).not.toHaveBeenCalled()
  await click('确认本批清理…')
  receiptCall.mockResolvedValue({ ok: true, data: receipt })
  const invalidation = vi.spyOn(client, 'invalidateQueries')
  await click('永久删除本批')
  expect(confirmCall).toHaveBeenCalledExactlyOnceWith({ previewId: preview.previewId })
  expect(container.textContent).toContain('候选 500 · 已删除 499 · 已跳过 1')
  expect(container.textContent).toContain('本批清理已提交')
  expect(previewCall).toHaveBeenCalledOnce()
  for (const domain of ['activity', 'operations', 'storage'])
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['local', domain] })
})
it('invalidates a preview when the retention selection changes and offers all four presets', async () => {
  await render()
  await click('预览清理范围')
  await click('30 天')
  expect(button('确认本批清理…')).toBeUndefined()
  for (const value of ['30 天', '90 天', '180 天', '365 天']) expect(button(value)).toBeDefined()
  await click('预览清理范围')
  expect(previewCall).toHaveBeenLastCalledWith({ retentionDays: 30 })
})
it('shows a truthful empty state and never enables irreversible confirmation for an empty batch', async () => {
  previewCall.mockResolvedValue({
    ok: true,
    data: {
      ...preview,
      sessions: { count: 0, hasMore: false },
      operations: { count: 0, hasMore: false },
    },
  })
  await render()
  await click('预览清理范围')
  expect(container.textContent).toContain('本批没有可清理的记录')
  expect(container.textContent).toContain('这不代表没有历史记录')
  expect(button('确认本批清理…')).toBeUndefined()
  expect(confirmCall).not.toHaveBeenCalled()
})
it('allows discarding a slow preview and ignores its late response after a newer request', async () => {
  const delayed = deferred<IpcResult<HistoryCleanupPreview>>()
  previewCall.mockImplementationOnce(() => delayed.promise)
  await render()
  await click('预览清理范围')
  expect(button('预览清理范围').disabled).toBe(true)
  await click('放弃本批预览')
  await click('预览清理范围')
  await act(async () =>
    delayed.resolve({ ok: true, data: { ...preview, operations: { count: 400, hasMore: false } } }),
  )
  expect(container.textContent).toContain('3 条操作记录')
  expect(container.textContent).not.toContain('400 条操作记录')
})
it('blocks duplicate confirmation while pending and does not claim cancellation after submit', async () => {
  const delayed = deferred<IpcResult<HistoryCleanupResult>>()
  confirmCall.mockImplementationOnce(() => delayed.promise)
  await render()
  await click('预览清理范围')
  await click('确认本批清理…')
  const submit = button('永久删除本批')
  await act(async () => {
    submit.click()
    submit.click()
  })
  expect(confirmCall).toHaveBeenCalledOnce()
  expect(button('取消').disabled).toBe(true)
  expect(button('永久删除本批').disabled).toBe(true)
  expect(button('放弃本批预览').disabled).toBe(true)
  receiptCall.mockResolvedValue({ ok: true, data: receipt })
  await act(async () => delayed.resolve({ ok: true, data: { receipt, replayed: false } }))
  await flush()
  expect(container.textContent).toContain('本批清理已提交')
})
it('resolves a lost confirmation response by receipt lookup without a second deletion request', async () => {
  confirmCall.mockRejectedValueOnce(new Error('lost IPC response'))
  await render()
  await click('预览清理范围')
  await click('确认本批清理…')
  await click('永久删除本批')
  expect(container.textContent).toContain('错误不一定代表未提交')
  expect(button('预览清理范围').disabled).toBe(true)
  receiptCall.mockResolvedValue({ ok: true, data: receipt })
  await click('查询回执')
  expect(container.textContent).toContain('没有再次删除或执行新批次')
  expect(button('确认本批清理…')).toBeUndefined()
  expect(confirmCall).toHaveBeenCalledOnce()
})
it('does not mistake another batch receipt for success and retries only the same opaque token', async () => {
  confirmCall.mockRejectedValueOnce(new Error('lost response'))
  await render()
  await click('预览清理范围')
  await click('确认本批清理…')
  await click('永久删除本批')
  receiptCall.mockResolvedValue({
    ok: true,
    data: { ...receipt, previewId: 'a55f600d-292a-4e50-bf72-651b6e44f31b' },
  })
  await click('查询回执')
  expect(container.textContent).toContain('错误不一定代表未提交')
  expect(container.textContent).not.toContain('已核对到本批之前提交的回执')
  confirmCall.mockResolvedValue({ ok: true, data: { receipt, replayed: true } })
  receiptCall.mockResolvedValue({ ok: true, data: receipt })
  await click('确认本批清理…')
  await click('永久删除本批')
  expect(confirmCall.mock.calls).toEqual([
    [{ previewId: preview.previewId }],
    [{ previewId: preview.previewId }],
  ])
  expect(previewCall).toHaveBeenCalledOnce()
})
it('expires explicitly rather than silently obtaining and executing a different batch', async () => {
  confirmCall.mockResolvedValue({
    ok: false,
    code: 'HISTORY_CLEANUP_PREVIEW_EXPIRED',
    message: 'expired',
  })
  await render()
  await click('预览清理范围')
  await click('确认本批清理…')
  await click('永久删除本批')
  expect(container.textContent).toContain('预览已过期')
  expect(button('确认本批清理…')).toBeUndefined()
  expect(button('预览清理范围').disabled).toBe(false)
  expect(previewCall).toHaveBeenCalledOnce()
})
it('reports preview/receipt failures and supports explicit retry while preserving the no-deletion guarantee', async () => {
  previewCall.mockResolvedValueOnce({ ok: false, code: 'COMMAND_FAILED', message: 'failed' })
  receiptCall.mockResolvedValueOnce({
    ok: false,
    code: 'HISTORY_CLEANUP_RECEIPT_INVALID',
    message: 'invalid',
  })
  await render()
  expect(container.textContent).toContain('最近清理回执无法安全读取')
  await click('预览清理范围')
  expect(container.textContent).toContain('操作未完成')
  await click('预览清理范围')
  expect(button('确认本批清理…')).toBeDefined()
  await click('查询回执')
  expect(confirmCall).not.toHaveBeenCalled()
})
it('renders English help and a persisted receipt without initiating any cleanup on remount', async () => {
  localStorage.setItem('contextweave:locale', 'en-US')
  receiptCall.mockResolvedValue({ ok: true, data: receipt })
  await render()
  expect(container.textContent).toContain('Latest committed cleanup receipt')
  expect(container.textContent).toContain('Selected 500 · Deleted 499 · Skipped 1')
  expect(container.textContent).toContain('permanent audit')
  expect(previewCall).not.toHaveBeenCalled()
  expect(confirmCall).not.toHaveBeenCalled()
})
