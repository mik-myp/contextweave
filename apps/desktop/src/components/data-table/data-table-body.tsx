import type { ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import type { DataTableFeatures } from './data-table-features'

export function DataTableBody<TData extends RowData>({
  table,
  label,
  loading,
  selectedRowId,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  table: ReactTable<DataTableFeatures, TData>
  label: string
  loading?: boolean
  selectedRowId?: string
  emptyTitle: string
  emptyDescription: string
  emptyAction?: ReactNode
}) {
  const columns = table.getVisibleLeafColumns()
  const rows = table.getRowModel().rows
  return (
    <div
      data-slot="data-table-surface"
      className="overflow-hidden rounded-md border"
      aria-busy={loading}
    >
      <Table aria-label={label}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(header.column.columnDef.meta?.align === 'end' && 'text-end')}
                    aria-sort={
                      header.column.getCanSort()
                        ? sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => header.column.toggleSorting()}
                        aria-label={`排序：${header.column.columnDef.meta?.label ?? header.column.id}`}
                      >
                        <table.FlexRender header={header} />
                        {sorted === 'asc' ? (
                          <ArrowUpIcon data-icon="inline-end" />
                        ) : sorted === 'desc' ? (
                          <ArrowDownIcon data-icon="inline-end" />
                        ) : (
                          <ArrowUpDownIcon data-icon="inline-end" />
                        )}
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }, (_, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.id}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id} data-state={row.id === selectedRowId ? 'selected' : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(cell.column.columnDef.meta?.align === 'end' && 'text-end')}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={Math.max(1, columns.length)}>
                <Empty className="min-h-48">
                  <EmptyHeader>
                    <EmptyTitle>{emptyTitle}</EmptyTitle>
                    <EmptyDescription>{emptyDescription}</EmptyDescription>
                  </EmptyHeader>
                  {emptyAction}
                </Empty>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
