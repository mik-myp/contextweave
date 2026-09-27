import { useId } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { useI18n } from '@/i18n'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const pageSizes = [10, 20, 30, 40, 50, 100].map((value) => ({ value, label: String(value) }))
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
  const id = useId()
  const disabled = history.loading || Boolean(history.error)
  return (
    <div
      data-slot="history-pagination"
      className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-3"
    >
      <span className="text-sm text-muted-foreground" role="status">
        {history.loading
          ? t('history.loading')
          : history.error
            ? t('table.error')
            : t('history.pageCount').replace('{count}', String(history.table.options.data.length))}
      </span>
      <label htmlFor={id} className="text-sm">
        {t('table.pageSize')}
      </label>
      <Select
        items={pageSizes}
        value={history.table.state.pagination.pageSize}
        onValueChange={(value) => {
          if (value) history.table.setPageSize(value)
        }}
      >
        <SelectTrigger id={id} size="sm" className="w-18">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {pageSizes.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={history.first} disabled={history.loading}>
        {t('history.latest')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={history.previous}
        disabled={disabled || !history.hasPrevious}
      >
        {t('table.previous')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={history.next}
        disabled={disabled || !history.hasNext}
      >
        {t('table.next')}
      </Button>
      {history.loading && (
        <Button variant="ghost" size="sm" onClick={history.cancel}>
          {t('history.cancel')}
        </Button>
      )}
    </div>
  )
}
