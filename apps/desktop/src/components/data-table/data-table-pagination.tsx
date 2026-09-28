import { useI18n } from '@/i18n'
import { useId, type ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationEllipsis,
} from '@/components/ui/pagination'
import { getPageItems } from './data-table-page-items'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import type { DataTableFeatures } from './data-table-features'

const defaultPageSizes = [10, 20, 30, 40, 50]
type PageAction = { onClick: () => void; disabled?: boolean; label?: string }

// Presentation only: cursor owners supply actions, never an inferred total or page index.
export function DataTablePaginationControls({
  status,
  pageSize,
  pages,
  first,
  previous,
  next,
  disabled = false,
  label,
  actions,
}: {
  status?: ReactNode
  pageSize?: {
    value: number
    options?: readonly number[]
    onChange: (value: number) => void
  }
  pages?: {
    current: number
    total: number
    onChange: (page: number) => void
    onLast: () => void
    disabled?: boolean
  }
  first?: PageAction
  previous: PageAction
  next: PageAction
  disabled?: boolean
  label?: string
  actions?: ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const pageSizes = (pageSize?.options ?? defaultPageSizes).map((value) => ({
    value,
    label: String(value),
  }))
  return (
    <div
      data-slot="data-table-pagination"
      className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-4"
    >
      {status !== undefined && (
        <span className="text-sm text-muted-foreground" role="status">
          {status}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-4 sm:gap-6">
        {pageSize && (
          <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-sm">
              {t('table.pageSize')}
            </label>
            <Select
              items={pageSizes}
              disabled={disabled}
              value={pageSize.value}
              onValueChange={(value) => {
                if (value !== null) pageSize.onChange(value)
              }}
            >
              <SelectTrigger id={id} size="sm" className="w-18">
                <SelectValue />
              </SelectTrigger>
              <SelectContent aria-label={t('table.pageSize')}>
                <SelectGroup>
                  {pageSizes.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
        {pages && (
          <span className="text-sm tabular-nums">
            {t('table.page')
              .replace('{page}', String(pages.current))
              .replace('{pages}', String(pages.total))}
          </span>
        )}
        <Pagination aria-label={label ?? t('table.pagination')} className="mx-0 w-auto justify-end">
          <PaginationContent className="flex-wrap justify-end gap-1">
            {first && (
              <PaginationItem className={pages ? 'hidden sm:block' : undefined}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={first.label ?? t('table.first')}
                  title={first.label ?? t('table.first')}
                  disabled={disabled || first.disabled}
                  onClick={first.onClick}
                >
                  <ChevronsLeftIcon className="rtl:rotate-180" />
                  <span className="sr-only">{first.label ?? t('table.first')}</span>
                </Button>
              </PaginationItem>
            )}
            <PaginationItem>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={previous.label ?? t('table.previous')}
                title={previous.label ?? t('table.previous')}
                disabled={disabled || previous.disabled}
                onClick={previous.onClick}
              >
                <ChevronLeftIcon className="rtl:rotate-180" />
                <span className="sr-only">{previous.label ?? t('table.previous')}</span>
              </Button>
            </PaginationItem>
            {pages &&
              getPageItems(pages.current, pages.total).map((item) => (
                <PaginationItem key={item}>
                  {typeof item === 'number' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={item === pages.current ? 'outline' : 'ghost'}
                      className="min-w-(--control-height-sm) px-2"
                      aria-label={t('table.goToPage').replace('{page}', String(item))}
                      aria-current={item === pages.current ? 'page' : undefined}
                      disabled={disabled || pages.disabled}
                      onClick={() => pages.onChange(item)}
                    >
                      {item}
                    </Button>
                  ) : (
                    <PaginationEllipsis className="size-(--control-height-sm)" />
                  )}
                </PaginationItem>
              ))}
            <PaginationItem>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={next.label ?? t('table.next')}
                title={next.label ?? t('table.next')}
                disabled={disabled || next.disabled}
                onClick={next.onClick}
              >
                <ChevronRightIcon className="rtl:rotate-180" />
                <span className="sr-only">{next.label ?? t('table.next')}</span>
              </Button>
            </PaginationItem>
            {pages && (
              <PaginationItem className="hidden sm:block">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={t('table.last')}
                  title={t('table.last')}
                  disabled={disabled || next.disabled}
                  onClick={pages.onLast}
                >
                  <ChevronsRightIcon className="rtl:rotate-180" />
                  <span className="sr-only">{t('table.last')}</span>
                </Button>
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
        {actions}
      </div>
    </div>
  )
}

export function DataTablePagination<TData extends RowData>({
  table,
  countLabel,
  disabled = false,
}: {
  countLabel?: (count: number) => string
  disabled?: boolean
  table: ReactTable<DataTableFeatures, TData>
}) {
  const { t } = useI18n()
  const { pageIndex, pageSize } = table.state.pagination
  const count = table.getFilteredRowModel().rows.length
  const pages = Math.max(1, table.getPageCount())
  return (
    <DataTablePaginationControls
      status={countLabel ? countLabel(count) : t('table.total').replace('{count}', String(count))}
      disabled={disabled}
      pageSize={{
        value: pageSize,
        onChange: (value) => {
          table.setPageSize(value)
          table.setPageIndex(0)
        },
      }}
      pages={{
        current: Math.min(pageIndex + 1, pages),
        total: pages,
        onChange: (page) => table.setPageIndex(page - 1),
        onLast: () => table.lastPage(),
        disabled: count === 0,
      }}
      first={{ onClick: () => table.firstPage(), disabled: !table.getCanPreviousPage() }}
      previous={{ onClick: () => table.previousPage(), disabled: !table.getCanPreviousPage() }}
      next={{ onClick: () => table.nextPage(), disabled: !table.getCanNextPage() }}
    />
  )
}
