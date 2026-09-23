import { useI18n } from '@/i18n'
import { useRef, type ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTableBody } from './data-table-body'
import { DataTablePagination } from './data-table-pagination'
import { useDataTableScroll } from './use-data-table-scroll'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { DataTableFeatures } from './data-table-features'

export function DataTable<TData extends RowData>({
  table,
  label,
  searchPlaceholder,
  filters,
  actions,
  loading,
  selectedRowId,
  emptyTitle,
  emptyDescription,
  emptyAction,
  error,
  onRetry,
  countLabel,
  bulkActions,
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
  error?: string
  onRetry?: () => void
  bulkActions?: ReactNode
  countLabel?: (count: number) => string
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLElement>(null)
  useDataTableScroll(ref, table.options.meta?.stateKey, loading)
  return (
    <section
      ref={ref}
      aria-label={label}
      className="flex min-w-0 flex-col gap-4"
      data-slot="data-table"
    >
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        actions={actions}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('table.error')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
        </Alert>
      ) : (
        <DataTableBody
          table={table}
          label={label}
          loading={loading}
          selectedRowId={selectedRowId}
          emptyTitle={emptyTitle ?? t('table.empty')}
          emptyDescription={emptyDescription ?? t('table.emptyDescription')}
          emptyAction={emptyAction}
        />
      )}
      {bulkActions}
      <DataTablePagination
        table={table}
        countLabel={countLabel}
        disabled={loading || Boolean(error)}
      />
    </section>
  )
}
