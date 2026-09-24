// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDef, ReactTable } from '@tanstack/react-table'
import type { DataTableFeatures } from './data-table-features'
import { DataTableStateProvider } from './data-table-state-provider'
import { useDataTable } from './use-data-table'
import { useDataTableScroll } from './use-data-table-scroll'

type RecordRow = { id: string; name: string; status: string; kernel: string }
const rows = Array.from({ length: 65 }, (_, index) => ({
  id: String(index),
  name: `Record ${index}`,
  status: index % 2 ? 'active' : 'stopped',
  kernel: index % 3 === 0 ? 'edge' : 'chromium',
}))
const columns: ColumnDef<DataTableFeatures, RecordRow, unknown>[] = [
  { accessorKey: 'name', enableGlobalFilter: true, meta: { label: 'Name' } },
  {
    accessorKey: 'status',
    enableGlobalFilter: false,
    filterFn: 'isOneOf',
    meta: { label: 'Status' },
  },
  {
    accessorKey: 'kernel',
    enableGlobalFilter: false,
    filterFn: 'isOneOf',
    meta: { label: 'Kernel' },
  },
]
const getRowId = (row: RecordRow) => row.id

// These assertions exercise observable state across route-style unmounts and data refreshes.
describe('shared data table state', () => {
  let root: Root
  let container: HTMLDivElement
  let table!: ReactTable<DataTableFeatures, RecordRow>
  function Harness({
    data,
    loading,
    stateKey,
  }: {
    data: RecordRow[]
    loading: boolean
    stateKey: string
  }) {
    table = useDataTable({ data, columns, getRowId, stateKey, loading, enableRowSelection: true })
    return (
      <output>
        {table
          .getRowModel()
          .rows.map((row) => row.id)
          .join(',')}
      </output>
    )
  }
  async function render(key: string | null, data = rows, loading = false) {
    await act(async () =>
      root.render(
        <DataTableStateProvider>
          {key && <Harness key={key} stateKey={key} data={data} loading={loading} />}
        </DataTableStateProvider>,
      ),
    )
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('selects only the current page and excludes hidden selections from bulk actions', async () => {
    await render('environments')
    await act(async () => table.toggleAllPageRowsSelected(true))
    expect(table.getSelectedRowModel().rows).toHaveLength(20)
    await act(async () => table.setColumnFilters([{ id: 'status', value: ['active'] }]))
    expect(table.getFilteredSelectedRowModel().rows).toHaveLength(10)
    expect(table.getSelectedRowModel().rows).toHaveLength(20)
    await render(
      'environments',
      rows.filter((row) => row.id !== '1'),
    )
    expect(table.state.rowSelection).not.toHaveProperty('1')
    await render(null)
    await render('environments')
    expect(table.getSelectedRowModel().rows).toHaveLength(0)
    expect(table.state.columnFilters).toEqual([{ id: 'status', value: ['active'] }])
  })

  it('restores each list independently, including filters, sorting, visibility and page size', async () => {
    await render('environments')
    expect(table.state.pagination.pageSize).toBe(20)
    await act(async () => {
      table.setGlobalFilter('Record')
      table.setColumnFilters([{ id: 'status', value: 'active' }])
      table.setSorting([{ id: 'name', desc: true }])
      table.setColumnVisibility({ status: false })
      table.setPageSize(10)
      table.setPageIndex(1)
    })
    const visible = container.textContent
    const state = table.state
    await render('proxies')
    expect(table.state.pagination.pageIndex).toBe(0)
    expect(table.state.columnFilters).toEqual([])
    await render(null)
    await render('environments')
    expect(table.state).toEqual(state)
    expect(container.textContent).toBe(visible)
  })

  it('combines multi-value facets with search and counts the alternatives independently of their own filter', async () => {
    await render('environments')
    const status = table.getColumn('status')!
    const kernel = table.getColumn('kernel')!
    await act(async () => {
      status.setFilterValue(['active'])
      kernel.setFilterValue(['edge'])
      table.setPageSize(10)
    })
    expect(table.getFilteredRowModel().rows).toHaveLength(11)
    expect(table.getRowModel().rows).toHaveLength(10)
    expect([...status.getFacetedUniqueValues()]).toEqual([
      ['stopped', 11],
      ['active', 11],
    ])
    expect(kernel.getFacetedUniqueValues().get('chromium')).toBe(21)
    expect(kernel.getFacetedUniqueValues().get('edge')).toBe(11)

    await act(async () => status.setFilterValue(['active', 'stopped']))
    expect(table.getFilteredRowModel().rows).toHaveLength(22)
    await act(async () => table.setGlobalFilter('Record 1'))
    expect(table.getFilteredRowModel().rows.map((row) => row.id)).toEqual(['12', '15', '18'])
    expect([...status.getFacetedUniqueValues()]).toEqual([
      ['stopped', 2],
      ['active', 1],
    ])

    const state = table.state
    await render(null)
    await render('environments')
    expect(table.state).toEqual(state)
    expect(table.getFilteredRowModel().rows.map((row) => row.id)).toEqual(['12', '15', '18'])
  })

  it('removes the final facet selection and keeps older scalar selections readable', async () => {
    await render('environments')
    const status = table.getColumn('status')!
    await act(async () => status.setFilterValue('active'))
    expect(table.getFilteredRowModel().rows).toHaveLength(32)
    await act(async () => status.setFilterValue(['active', 'stopped']))
    expect(table.getFilteredRowModel().rows).toHaveLength(65)
    await act(async () => status.setFilterValue([]))
    expect(table.state.columnFilters).toEqual([])
    expect(table.getFilteredRowModel().rows).toHaveLength(65)
  })

  it('preserves a restored page during loading and clamps it only after a smaller result arrives', async () => {
    await render('environments')
    await act(async () => table.setPageIndex(3))
    await render(null)
    await render('environments', [], true)
    expect(table.state.pagination.pageIndex).toBe(3)
    await render('environments', rows, false)
    expect(table.state.pagination.pageIndex).toBe(3)
    expect(container.textContent).toBe('60,61,62,63,64')
    await render('environments', rows.slice(0, 25))
    expect(table.state.pagination.pageIndex).toBe(1)
    expect(container.textContent).toBe('20,21,22,23,24')
    await render('environments', [])
    expect(table.state.pagination.pageIndex).toBe(0)
  })
  it('restores the table viewport after loading without changing the surrounding page scroll', async () => {
    function ScrollList({ loading }: { loading: boolean }) {
      const ref = useRef<HTMLDivElement>(null)
      useDataTableScroll(ref, 'scroll-list', loading)
      return (
        <div ref={ref} data-table-scroll>
          List
        </div>
      )
    }
    const renderScroll = async (active: boolean, loading = false) => {
      await act(async () =>
        root.render(
          <DataTableStateProvider>
            <div data-scroll-restoration>
              {active ? <ScrollList loading={loading} /> : 'Editor'}
            </div>
          </DataTableStateProvider>,
        ),
      )
    }
    await renderScroll(true)
    const scroller = container.querySelector<HTMLElement>('[data-table-scroll]')!
    const pageScroller = container.querySelector<HTMLElement>('[data-scroll-restoration]')!
    scroller.scrollTop = 400
    scroller.dispatchEvent(new Event('scroll'))
    await renderScroll(false)
    // A detail page has its own offset; it must not replace the list's saved offset.
    pageScroller.scrollTop = 50
    pageScroller.dispatchEvent(new Event('scroll'))
    await renderScroll(true, true)
    const restoredScroller = container.querySelector<HTMLElement>('[data-table-scroll]')!
    expect(restoredScroller.scrollTop).toBe(0)
    await renderScroll(true)
    expect(restoredScroller.scrollTop).toBe(400)
    expect(pageScroller.scrollTop).toBe(50)
  })
})
