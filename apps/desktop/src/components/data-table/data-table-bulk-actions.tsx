// Adapted from shadcn-admin (MIT); see THIRD_PARTY_NOTICES.md.
import type { ReactNode } from 'react'
import type { ReactTable, RowData } from '@tanstack/react-table'
import { XIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { DataTableFeatures } from './data-table-features'

export function DataTableBulkActions<TData extends RowData>({
  table,
  children,
  disabled,
}: {
  table: ReactTable<DataTableFeatures, TData>
  children: ReactNode
  disabled?: boolean
}) {
  const { t } = useI18n()
  const count = table.getFilteredSelectedRowModel().rows.length
  const selected = table.getSelectedRowModel().rows.length
  if (!selected) return null
  return (
    <div
      role="region"
      aria-label={t('table.bulkActions')}
      className="sticky bottom-3 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        aria-label={t('table.clearSelection')}
        onClick={() => table.resetRowSelection()}
      >
        <XIcon />
      </Button>
      <span className="px-1 text-sm tabular-nums" role="status">
        {t('table.selection').replace('{count}', String(count))}
      </span>
      {selected > count && (
        <span className="text-xs text-muted-foreground">
          {t('table.hiddenSelection').replace('{count}', String(selected - count))}
        </span>
      )}
      <Separator orientation="vertical" className="h-5" />
      {children}
    </div>
  )
}
