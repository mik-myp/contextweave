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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import type { DataTableFeatures } from './data-table-features'

const pageSizes = [10, 20, 50].map((value) => ({ value, label: String(value) }))
export function DataTablePagination<TData extends RowData>({
  table,
}: {
  table: ReactTable<DataTableFeatures, TData>
}) {
  const id = useId()
  const { pageIndex, pageSize } = table.state.pagination
  const count = table.getFilteredRowModel().rows.length
  const pages = Math.max(1, table.getPageCount())
  return (
    <div
      data-slot="data-table-pagination"
      className="flex flex-wrap items-center justify-between gap-4"
    >
      <span className="text-sm text-muted-foreground" role="status">
        共 {count} 条
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm">
            每页条数
          </label>
          <Select
            items={pageSizes}
            value={pageSize}
            onValueChange={(value) => {
              if (value) {
                table.setPageSize(value)
                table.setPageIndex(0)
              }
            }}
          >
            <SelectTrigger id={id} className="h-8 w-18">
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
        </div>
        <span className="text-sm tabular-nums">
          第 {Math.min(pageIndex + 1, pages)} / {pages} 页
        </span>
        <nav aria-label="表格分页" className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="首页"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.firstPage()}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="上一页"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="下一页"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="末页"
            disabled={!table.getCanNextPage()}
            onClick={() => table.lastPage()}
          >
            <ChevronsRightIcon />
          </Button>
        </nav>
      </div>
    </div>
  )
}
