import type { ComponentProps, ReactNode } from 'react'
import type { ColumnDef, RowData } from '@tanstack/react-table'
import { RefreshCwIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { DataTable } from './data-table'
import { DataTablePaginationControls } from './data-table-pagination'
import { useDataTable } from './use-data-table'
import type { DataTableFeatures } from './data-table-features'

/** A server cursor remains owned by its feature; sorting/searching explicitly cover this page. */
export function CursorDataTable<T extends RowData>({
  data,
  columns,
  getRowId,
  label,
  emptyTitle,
  loading,
  refreshing,
  error,
  onRefresh,
  refreshLabel,
  previous,
  next,
  actions,
}: {
  data: T[]
  columns: ColumnDef<DataTableFeatures, T, unknown>[]
  getRowId(row: T): string
  label: string
  emptyTitle: string
  loading: boolean
  refreshing: boolean
  error?: string
  onRefresh(): void
  refreshLabel: string
  previous: ComponentProps<typeof DataTablePaginationControls>['previous']
  next: ComponentProps<typeof DataTablePaginationControls>['next']
  actions?: ReactNode
}) {
  const { t } = useI18n()
  const table = useDataTable({
    data,
    columns,
    getRowId,
    loading,
    initialState: { pagination: { pageIndex: 0, pageSize: 100 } },
  })
  return (
    <DataTable
      table={table}
      label={label}
      searchPlaceholder={t('table.searchCurrentPage')}
      loading={loading}
      error={error}
      onRetry={onRefresh}
      emptyTitle={emptyTitle}
      actions={
        <>
          {actions}
          <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
            <RefreshCwIcon data-icon="inline-start" />
            {refreshLabel}
          </Button>
        </>
      }
      pagination={
        <DataTablePaginationControls
          status={t('table.cursorScope')}
          disabled={refreshing}
          previous={previous}
          next={next}
        />
      }
    />
  )
}
