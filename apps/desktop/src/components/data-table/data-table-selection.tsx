// Adapted from shadcn-admin (MIT); see THIRD_PARTY_NOTICES.md.
import type { ColumnDef, RowData } from '@tanstack/react-table'
import type { I18nContextValue } from '@/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import type { DataTableFeatures } from './data-table-features'

export function selectionColumn<TData extends RowData>(
  t: I18nContextValue['t'],
): ColumnDef<DataTableFeatures, TData, unknown> {
  return {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        aria-label={t('table.selectPage')}
        disabled={!table.getRowModel().rows.length}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={!table.getIsAllPageRowsSelected() && table.getIsSomePageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={t('table.selectRow').replace('{id}', row.id)}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        disabled={!row.getCanSelect()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
    enableGlobalFilter: false,
  }
}
