// @vitest-environment jsdom
import { act, useEffect, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ColumnDef, ReactTable } from '@tanstack/react-table'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { DataTableFeatures } from './data-table-features'
import { DataTablePagination, DataTablePaginationControls } from './data-table-pagination'
import { useDataTable } from './use-data-table'

type RecordRow = { id: string; name: string }
const rows = Array.from({ length: 65 }, (_, index) => ({
  id: String(index),
  name: `Record ${index}`,
}))
const columns: ColumnDef<DataTableFeatures, RecordRow, unknown>[] = [{ accessorKey: 'name' }]
const getRowId = (row: RecordRow) => row.id
let root: Root, container: HTMLDivElement, table: ReactTable<DataTableFeatures, RecordRow>
function Harness({
  data = rows,
  disabled = false,
  countLabel,
}: {
  data?: RecordRow[]
  disabled?: boolean
  countLabel?: (count: number) => string
}) {
  const currentTable = useDataTable({ data, columns, getRowId })
  useEffect(() => {
    table = currentTable
  }, [currentTable])
  return <DataTablePagination table={currentTable} disabled={disabled} countLabel={countLabel} />
}
async function render(element: ReactNode = <Harness />) {
  await act(async () => root.render(<I18nProvider>{element}</I18nProvider>))
}
function button(label: string) {
  const target = [...container.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  )
  if (!target) throw new Error(`Missing button ${label}`)
  return target
}
async function click(label: string) {
  await act(async () => button(label).click())
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('numbered data table pagination', () => {
  it('keeps exact counts, numbered jumps and first/previous/next/last boundaries', async () => {
    await render()
    expect(container.querySelector('[role="status"]')?.textContent).toBe('共 65 条')
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('表格分页')
    expect(container.textContent).toContain('第 1 / 4 页')
    expect(button('首页').disabled).toBe(true)
    expect(button('上一页').disabled).toBe(true)
    await click('下一页')
    expect(table.state.pagination.pageIndex).toBe(1)
    expect(button('转到第 2 页').getAttribute('aria-current')).toBe('page')
    await click('转到第 3 页')
    expect(table.state.pagination.pageIndex).toBe(2)
    await click('末页')
    expect(table.state.pagination.pageIndex).toBe(3)
    expect(button('下一页').disabled).toBe(true)
    expect(button('末页').disabled).toBe(true)
    await click('上一页')
    expect(table.state.pagination.pageIndex).toBe(2)
    await click('首页')
    expect(table.state.pagination.pageIndex).toBe(0)
  })

  it('opens the real Base UI page-size selector with the keyboard and resets to page one', async () => {
    await render()
    await click('末页')
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    expect(container.querySelector('label')?.htmlFor).toBe(trigger.id)
    expect(trigger.querySelector('[data-slot="select-value"]')?.textContent).toBe('20')
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((option) => option.textContent)).toEqual(['10', '20', '30', '40', '50'])
    await act(async () => options.find((option) => option.textContent === '50')!.click())
    expect(table.state.pagination).toEqual({ pageIndex: 0, pageSize: 50 })
    expect(trigger.querySelector('[data-slot="select-value"]')?.textContent).toBe('50')
    expect(container.textContent).toContain('第 1 / 2 页')
  })

  it('counts filtered records and preserves caller-supplied count labels', async () => {
    const countLabel = (count: number) => `Found ${count} rows`
    await render(<Harness countLabel={countLabel} />)
    await act(async () => table.setGlobalFilter('Record 6'))
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Found 6 rows')
    expect(container.textContent).toContain('第 1 / 1 页')
    expect(button('下一页').disabled).toBe(true)
  })

  it('disables empty page navigation without disabling page-size selection', async () => {
    await render(<Harness data={[]} />)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('共 0 条')
    expect(container.textContent).toContain('第 1 / 1 页')
    for (const node of container.querySelectorAll<HTMLButtonElement>('nav button')) {
      expect(node.disabled).toBe(true)
    }
    expect(container.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(false)
  })

  it('blocks all table pagination changes while loading or failed', async () => {
    await render(<Harness disabled />)
    for (const node of container.querySelectorAll('button')) {
      expect(node.disabled).toBe(true)
    }
    await click('下一页')
    await click('转到第 3 页')
    await click('末页')
    expect(table.state.pagination).toEqual({ pageIndex: 0, pageSize: 20 })
  })

  it('uses translated accessible names for icon navigation', async () => {
    localStorage.setItem('contextweave:locale', 'en-US')
    await render()
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Table pagination')
    expect(button('First page').disabled).toBe(true)
    await click('Next page')
    expect(container.textContent).toContain('Page 2 of 4')
    expect(button('Go to page 2').getAttribute('aria-current')).toBe('page')
  })
})

describe('controlled cursor pagination', () => {
  it('only renders owned cursor actions, never invents totals, page numbers, or a size selector', async () => {
    const first = vi.fn(),
      previous = vi.fn(),
      next = vi.fn()
    await render(
      <DataTablePaginationControls
        status="This page: 7"
        label="Cursor history"
        first={{ onClick: first, label: 'Restart history' }}
        previous={{ onClick: previous, disabled: true }}
        next={{ onClick: next }}
      />,
    )
    expect(container.querySelector('[data-slot="data-table-pagination"]')).not.toBeNull()
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Cursor history')
    expect(container.querySelectorAll('nav button')).toHaveLength(3)
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(container.textContent).not.toContain('共')
    expect(container.textContent).not.toContain('第')
    expect(container.querySelector('button[aria-label="末页"]')).toBeNull()
    await click('上一页')
    expect(previous).not.toHaveBeenCalled()
    await click('下一页')
    expect(next).toHaveBeenCalledTimes(1)
    await click('Restart history')
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('supports fixed-size previous/next views and disables repeat actions while loading', async () => {
    const previous = vi.fn(),
      next = vi.fn()
    const props: ComponentProps<typeof DataTablePaginationControls> = {
      previous: { onClick: previous },
      next: { onClick: next },
    }
    await render(<DataTablePaginationControls {...props} disabled />)
    expect(container.querySelectorAll('nav button')).toHaveLength(2)
    await click('上一页')
    await click('下一页')
    expect(previous).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    await render(<DataTablePaginationControls {...props} />)
    await click('上一页')
    await click('下一页')
    expect(previous).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
