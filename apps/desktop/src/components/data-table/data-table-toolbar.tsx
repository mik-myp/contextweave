import type { ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DataTableViewOptions } from './data-table-view-options'
import type { DataTableFeatures } from './data-table-features'

export function DataTableToolbar<TData extends RowData>({
  table,
  searchPlaceholder,
  filters,
  actions,
}: {
  table: ReactTable<DataTableFeatures, TData>
  searchPlaceholder: string
  filters?: ReactNode
  actions?: ReactNode
}) {
  const filtered = Boolean(table.state.globalFilter) || table.state.columnFilters.length > 0
  return (
    <div
      data-slot="data-table-toolbar"
      className="flex flex-wrap items-start justify-between gap-3"
    >
      <div
        data-slot="data-table-search"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
      >
        <Input
          className="h-8 w-full sm:w-60"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={String(table.state.globalFilter ?? '')}
          onChange={(event) => {
            table.setGlobalFilter(event.target.value)
            table.setPageIndex(0)
          }}
        />
        {filters}
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              table.resetGlobalFilter()
              table.resetColumnFilters()
              table.setPageIndex(0)
            }}
          >
            <XIcon data-icon="inline-start" />
            重置筛选
          </Button>
        )}
      </div>
      <div
        data-slot="data-table-actions"
        className="ms-auto flex shrink-0 flex-wrap items-center gap-2"
      >
        {actions}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
