import { useI18n } from '@/i18n'
import { useId } from 'react'
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

const pageSizes = [10, 20, 30, 40, 50].map((value) => ({ value, label: String(value) }))
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
  const id = useId()
  const { pageIndex, pageSize } = table.state.pagination
  const count = table.getFilteredRowModel().rows.length
  const pages = Math.max(1, table.getPageCount())
  const currentPage = Math.min(pageIndex + 1, pages)
  return (
    <div
      data-slot="data-table-pagination"
      className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-4"
    >
      <span className="text-sm text-muted-foreground" role="status">
        {countLabel ? countLabel(count) : t('table.total').replace('{count}', String(count))}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-4 sm:gap-6">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm">
            {t('table.pageSize')}
          </label>
          <Select
            items={pageSizes}
            disabled={disabled}
            value={pageSize}
            onValueChange={(value) => {
              if (value) {
                table.setPageSize(value)
                table.setPageIndex(0)
              }
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
        <span className="text-sm tabular-nums">
          {t('table.page').replace('{page}', String(currentPage)).replace('{pages}', String(pages))}
        </span>
        <Pagination aria-label={t('table.pagination')} className="mx-0 w-auto justify-end">
          <PaginationContent className="flex-wrap justify-end gap-1">
            <PaginationItem className="hidden sm:block">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t('table.first')}
                disabled={disabled || !table.getCanPreviousPage()}
                onClick={() => table.firstPage()}
              >
                <ChevronsLeftIcon className="rtl:rotate-180" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t('table.previous')}
                disabled={disabled || !table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeftIcon className="rtl:rotate-180" />
              </Button>
            </PaginationItem>
            {getPageItems(currentPage, pages).map((item) => (
              <PaginationItem key={item}>
                {typeof item === 'number' ? (
                  <Button
                    size="sm"
                    variant={item === currentPage ? 'outline' : 'ghost'}
                    className="min-w-(--control-height-sm) px-2"
                    aria-label={t('table.goToPage').replace('{page}', String(item))}
                    aria-current={item === currentPage ? 'page' : undefined}
                    disabled={disabled || count === 0}
                    onClick={() => table.setPageIndex(item - 1)}
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
                size="icon-sm"
                variant="outline"
                aria-label={t('table.next')}
                disabled={disabled || !table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ChevronRightIcon className="rtl:rotate-180" />
              </Button>
            </PaginationItem>
            <PaginationItem className="hidden sm:block">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t('table.last')}
                disabled={disabled || !table.getCanNextPage()}
                onClick={() => table.lastPage()}
              >
                <ChevronsRightIcon className="rtl:rotate-180" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
