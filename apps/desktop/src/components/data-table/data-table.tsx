import type { ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTableBody } from './data-table-body'
import { DataTablePagination } from './data-table-pagination'
import type { DataTableFeatures } from './data-table-features'

export function DataTable<TData extends RowData>({
  table,
  label,
  searchPlaceholder,
  filters,
  actions,
  loading,
  selectedRowId,
  emptyTitle = '暂无数据',
  emptyDescription = '添加记录后会显示在这里。',
  emptyAction,
}: {
  table: ReactTable<DataTableFeatures, TData>
  label: string
  searchPlaceholder: string
  filters?: ReactNode
  actions?: ReactNode
  loading?: boolean
  selectedRowId?: string
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
}) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-4" data-slot="data-table">
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        actions={actions}
      />
      <DataTableBody
        table={table}
        label={label}
        loading={loading}
        selectedRowId={selectedRowId}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        emptyAction={emptyAction}
      />
      <DataTablePagination table={table} />
    </section>
  )
}
