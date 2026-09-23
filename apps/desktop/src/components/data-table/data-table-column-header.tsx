import type { ReactNode } from 'react'
import type { Column, ReactTable, RowData } from '@tanstack/react-table'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  EyeOffIcon,
  ListRestartIcon,
} from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DataTableFeatures } from './data-table-features'

export function DataTableColumnHeader<TData extends RowData>({
  table,
  column,
  children,
}: {
  table: ReactTable<DataTableFeatures, TData>
  column: Column<DataTableFeatures, TData>
  children: ReactNode
}) {
  const { t } = useI18n()
  const canSort = column.getCanSort()
  const canHide = column.getCanHide()
  const sorted = column.getIsSorted()
  if (!canSort && !canHide) return children
  const label = column.columnDef.meta?.label ?? column.id
  const SortIcon =
    sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ChevronsUpDownIcon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="-ms-(--control-padding-sm)" />}
        aria-label={t('table.columnMenu').replace('{column}', label)}
      >
        {children}
        {canSort && <SortIcon data-icon="inline-end" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {canSort && (
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={sorted || ''}
              onValueChange={(direction) => {
                column.toggleSorting(direction === 'desc', false)
                table.setPageIndex(0)
              }}
            >
              <DropdownMenuRadioItem value="asc" closeOnClick>
                <ArrowUpIcon />
                {t('table.sortAscending')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc" closeOnClick>
                <ArrowDownIcon />
                {t('table.sortDescending')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {sorted && (
              <DropdownMenuItem
                onClick={() => {
                  column.clearSorting()
                  table.setPageIndex(0)
                }}
              >
                <ListRestartIcon />
                {t('table.clearSort')}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        )}
        {canSort && canHide && <DropdownMenuSeparator />}
        {canHide && (
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOffIcon />
              {t('table.hideColumn')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
