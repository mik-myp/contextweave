import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  operationHistoryQuerySchema,
  type OperationHistoryQuery,
  type OperationSummary,
  type HistoryPage,
  type IpcResult,
} from '@contextweave/contracts'
import { DataTableStateProvider } from '@/components/data-table/data-table-state-provider'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { I18nProvider } from '@/i18n'
import { HistoryPagination } from '../components/history-pagination'
import { useHistoryTable } from './use-history-table'

const columns: ColumnDef<DataTableFeatures, OperationSummary, unknown>[] = [
  { accessorKey: 'phase' },
  { accessorKey: 'status' },
  { accessorKey: 'startedAt' },
]
const getRowId = (row: OperationSummary) => row.operationId
function page(
  id: string,
  previousCursor: string | null = null,
  nextCursor: string | null = null,
): IpcResult<HistoryPage<OperationSummary>> {
  return {
    ok: true,
    data: {
      items: [
        {
          workspaceId: '00000000-0000-4000-8000-000000000001',
          operationId: id,
          environmentId: null,
          kind: 'install',
          status: 'succeeded',
          phase: id,
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: null,
          errorCode: null,
        },
      ],
      previousCursor,
      nextCursor,
    },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}

describe('server history table', () => {
  let root: Root, container: HTMLDivElement, client: QueryClient
  let history!: ReturnType<typeof useHistoryTable<OperationSummary, OperationHistoryQuery>>
  const loadPage =
    vi.fn<(query: OperationHistoryQuery) => Promise<IpcResult<HistoryPage<OperationSummary>>>>()
  function Harness() {
    history = useHistoryTable({
      domain: 'operations',
      columns,
      getRowId,
      schema: operationHistoryQuerySchema,
      loadPage,
    })
    return (
      <>
        <output>
          {history.error ??
            history.table
              .getRowModel()
              .rows.map((row) => row.id)
              .join(',')}
        </output>
        <HistoryPagination history={history} />
      </>
    )
  }
  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  async function render(visible = true) {
    await act(async () =>
      root.render(
        <TestWorkspaceProvider>
          <I18nProvider>
            <QueryClientProvider client={client}>
              <DataTableStateProvider>{visible && <Harness />}</DataTableStateProvider>
            </QueryClientProvider>
          </I18nProvider>
        </TestWorkspaceProvider>,
      ),
    )
    await flush()
  }
  function button(label: string) {
    const target = [...container.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === label || node.textContent === label,
    )
    if (!target) throw new Error(`Missing button ${label}`)
    return target
  }
  async function click(label: string) {
    await change(() => button(label).click())
  }
  async function change(fn: () => void) {
    await act(async () => fn())
    await flush()
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000, networkMode: 'always' } },
    })
    loadPage
      .mockReset()
      .mockImplementation(async (query) =>
        page(
          query.cursor ? 'second' : 'first',
          query.cursor ? 'previous' : null,
          query.cursor ? null : 'next',
        ),
      )
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.unstubAllGlobals()
  })
  it('pages in both directions, tells only this-page count, and does not cache an entire cursor trail', async () => {
    await render()
    expect(loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 20, cursor: null, sortBy: 'startedAt', direction: 'desc' }),
    )
    expect(container.textContent).toContain('本页 1 条（未统计全部历史）')
    expect(container.querySelector('[data-slot="data-table-pagination"]')).not.toBeNull()
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('表格分页')
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
    expect(container.querySelector('button[aria-label="末页"]')).toBeNull()
    expect(container.textContent).not.toMatch(/第 \d+ \/ \d+ 页|共 \d+ 条/)
    expect(button('上一页').disabled).toBe(true)
    const next = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '下一页',
    )!
    expect(next.disabled).toBe(false)
    await change(() => next.click())
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next' }))
    expect(history.table.getRowModel().rows[0]?.id).toBe('second')
    expect(history.hasNext).toBe(false)
    await flush()
    expect(client.getQueryCache().getAll()).toHaveLength(1)
    await click('上一页')
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'previous' }))
    await click('返回首段')
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }))
  })
  it('sends global search, column sort, filters and page size to the server and resets the cursor', async () => {
    await render()
    await change(history.next)
    await change(() => history.table.setGlobalFilter('older-than-first-page'))
    expect(loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, search: 'older-than-first-page' }),
    )
    // Server matching is authoritative: a page isn't filtered again by its visible phase string.
    expect(history.table.getRowModel().rows).toHaveLength(1)
    await change(() => history.table.setSorting([{ id: 'phase', desc: false }]))
    await change(() => history.table.setColumnFilters([{ id: 'status', value: ['failed'] }]))
    await change(() => history.table.setPageSize(50))
    expect(loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 50,
        sortBy: 'phase',
        direction: 'asc',
        statuses: ['failed'],
        cursor: null,
      }),
    )
  })
  it('retains one page token and view on navigation while leaving stale cached pages behind', async () => {
    await render()
    await change(history.next)
    await change(() => history.table.getColumn('phase')?.toggleVisibility(false))
    await render(false)
    await flush()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    await render()
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next' }))
    expect(history.table.getColumn('phase')?.getIsVisible()).toBe(false)
  })
  it('ignores superseded responses and supports honest cancel/retry without hanging in loading', async () => {
    const slow = deferred<IpcResult<HistoryPage<OperationSummary>>>()
    loadPage.mockImplementationOnce(() => slow.promise)
    await render()
    expect(history.loading).toBe(true)
    await change(history.cancel)
    expect(history.loading).toBe(false)
    expect(history.error).toContain('已取消等待')
    await change(history.retry)
    expect(history.error).toBeUndefined()
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
    await act(async () => slow.resolve(page('must-not-appear')))
    await flush()
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
    const obsolete = deferred<IpcResult<HistoryPage<OperationSummary>>>()
    loadPage.mockImplementationOnce(() => obsolete.promise)
    await change(() => history.table.setGlobalFilter('slow-search'))
    await change(() => history.table.setGlobalFilter('new-search'))
    await act(async () => obsolete.resolve(page('obsolete-search')))
    await flush()
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'new-search' }))
  })
  it('really retries a cancelled refresh even when the previous page is still fresh in the cache', async () => {
    await render()
    const refresh = deferred<IpcResult<HistoryPage<OperationSummary>>>()
    loadPage.mockImplementationOnce(() => refresh.promise)
    await change(history.first)
    expect(history.loading).toBe(true)
    await change(history.cancel)
    const calls = loadPage.mock.calls.length
    await change(history.retry)
    expect(loadPage.mock.calls).toHaveLength(calls + 1)
    expect(history.error).toBeUndefined()
    await act(async () => refresh.resolve(page('ignored-refresh')))
    await flush()
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
  })

  it('drops a previously displayed page when cleanup deletes its cursor and revalidation fails', async () => {
    await render()
    await change(history.next)
    expect(history.table.getRowModel().rows[0]?.id).toBe('second')
    loadPage.mockResolvedValueOnce({ ok: false, code: 'HISTORY_CURSOR_STALE', message: 'stale' })
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ['workspace', '00000000-0000-4000-8000-000000000001', 'operations'],
      })
    })
    await flush()
    expect(history.error).toContain('分页边界记录已移除')
    expect(history.table.getRowModel().rows).toHaveLength(0)
    expect(history.hasPrevious).toBe(false)
    expect(history.hasNext).toBe(false)
    expect(button('上一页').disabled).toBe(true)
    expect(button('下一页').disabled).toBe(true)
    expect(button('返回首段').disabled).toBe(false)
    await click('返回首段')
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }))
  })
  it('surfaces failures and can retry or reset a stale cursor without falsely displaying a total', async () => {
    loadPage.mockResolvedValueOnce({ ok: false, code: 'HISTORY_CURSOR_STALE', message: 'stale' })
    await render()
    expect(history.error).toContain('分页边界记录已移除')
    expect(history.loading).toBe(false)
    await change(history.first)
    expect(history.error).toBeUndefined()
    expect(history.table.getRowModel().rows).toHaveLength(1)
  })
  it('keeps an empty cursor page honest and lets the user reload its first page', async () => {
    loadPage.mockResolvedValue({
      ok: true,
      data: { items: [], previousCursor: null, nextCursor: null },
    })
    await render()
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '本页 0 条（未统计全部历史）',
    )
    expect(container.querySelectorAll('nav button')).toHaveLength(3)
    expect(button('上一页').disabled).toBe(true)
    expect(button('下一页').disabled).toBe(true)
    await click('返回首段')
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }))
  })

  it('blocks repeat page clicks during a request but retains cancel and first-page recovery', async () => {
    await render()
    const slow = deferred<IpcResult<HistoryPage<OperationSummary>>>()
    loadPage.mockReturnValueOnce(slow.promise)
    await click('下一页')
    const calls = loadPage.mock.calls.length
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在读取历史…')
    for (const label of ['返回首段', '上一页', '下一页']) {
      expect(button(label).disabled).toBe(true)
      await click(label)
    }
    expect(loadPage).toHaveBeenCalledTimes(calls)
    await click('取消等待')
    expect(history.loading).toBe(false)
    expect(history.error).toContain('已取消等待')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('读取失败')
    expect(button('上一页').disabled).toBe(true)
    expect(button('下一页').disabled).toBe(true)
    await click('返回首段')
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }))
    await act(async () => slow.resolve(page('cancelled-page')))
    await flush()
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
  })

  it('changes page size through Base UI, resets the query-bound cursor and ignores the old page', async () => {
    await render()
    const slow = deferred<IpcResult<HistoryPage<OperationSummary>>>()
    loadPage.mockReturnValueOnce(slow.promise)
    await click('下一页')
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    // Changing the query remains available while waiting, as before the visual unification.
    expect(trigger.disabled).toBe(false)
    expect(container.querySelector('label')?.htmlFor).toBe(trigger.id)
    await change(() => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((option) => option.textContent)).toEqual([
      '10',
      '20',
      '30',
      '40',
      '50',
      '100',
    ])
    await change(() => options.find((option) => option.textContent === '100')!.click())
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, cursor: null }))
    expect(history.table.state.pagination).toEqual({ pageIndex: 0, pageSize: 100 })
    await act(async () => slow.resolve(page('obsolete-size-page')))
    await flush()
    expect(history.table.getRowModel().rows[0]?.id).toBe('first')
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  })
})
