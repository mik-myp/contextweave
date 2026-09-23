import type { ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { DataTableColumnHeader } from './data-table-column-header'
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
      className="overflow-hidden rounded-lg border bg-background"
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
                    className={cn(
                      'px-4',
                      header.column.columnDef.meta?.align === 'end' && 'text-end',
                    )}
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
                    {header.isPlaceholder ? null : (
                      <DataTableColumnHeader table={table} column={header.column}>
                        <table.FlexRender header={header} />
                      </DataTableColumnHeader>
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
              <TableRow
                key={row.id}
                data-state={
                  row.getIsSelected() || row.id === selectedRowId ? 'selected' : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'px-4 py-(--table-cell-py)',
                      cell.column.columnDef.meta?.align === 'end' && 'text-end',
                    )}
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
