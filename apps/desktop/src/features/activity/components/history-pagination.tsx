import type { ReactTable, RowData } from '@tanstack/react-table'
import { useI18n } from '@/i18n'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { DataTablePaginationControls } from '@/components/data-table/data-table-pagination'
import { Button } from '@/components/ui/button'

const pageSizes = [10, 20, 30, 40, 50, 100]
export function HistoryPagination<T extends RowData>({
  history,
}: {
  history: {
    table: ReactTable<DataTableFeatures, T>
    loading: boolean
    error?: string
    hasPrevious: boolean
    hasNext: boolean
    first: () => void
    previous: () => void
    next: () => void
    cancel: () => void
  }
}) {
  const { t } = useI18n()
  const disabled = history.loading || Boolean(history.error)
  return (
    <DataTablePaginationControls
      status={
        history.loading
          ? t('history.loading')
          : history.error
            ? t('table.error')
            : t('history.pageCount').replace('{count}', String(history.table.options.data.length))
      }
      pageSize={{
        value: history.table.state.pagination.pageSize,
        options: pageSizes,
        onChange: (value) => history.table.setPageSize(value),
      }}
      first={{ onClick: history.first, disabled: history.loading, label: t('history.latest') }}
      previous={{ onClick: history.previous, disabled: disabled || !history.hasPrevious }}
      next={{ onClick: history.next, disabled: disabled || !history.hasNext }}
      actions={
        history.loading && (
          <Button variant="ghost" size="sm" onClick={history.cancel}>
            {t('history.cancel')}
          </Button>
        )
      }
    />
  )
}
