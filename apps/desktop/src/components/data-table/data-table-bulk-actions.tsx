// Adapted from shadcn-admin (MIT); see THIRD_PARTY_NOTICES.md.
import type { ReactTable, RowData } from '@tanstack/react-table'
import { XIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DataTableRowActions, type DataTableRowAction } from './data-table-row-actions'
import type { DataTableFeatures } from './data-table-features'

export function DataTableBulkActions<TData extends RowData>({
  table,
  actions,
  disabled,
}: {
  table: ReactTable<DataTableFeatures, TData>
  actions: DataTableRowAction[]
  disabled?: boolean
}) {
  const { t } = useI18n()
  const count = table.getFilteredSelectedRowModel().rows.length
  const selected = table.getSelectedRowModel().rows.length
  if (!selected) return null
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center">
      <div
        role="region"
        aria-label={t('table.bulkActions')}
        className="pointer-events-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={disabled}
                focusableWhenDisabled
                aria-label={t('table.clearSelection')}
                onClick={() => table.resetRowSelection()}
              />
            }
          >
            <XIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t('table.clearSelection')}</TooltipContent>
        </Tooltip>
        <span className="px-1 text-sm tabular-nums" role="status">
          {t('table.selection').replace('{count}', String(count))}
        </span>
        {selected > count && (
          <span className="text-xs text-muted-foreground">
            {t('table.hiddenSelection').replace('{count}', String(selected - count))}
          </span>
        )}
        <Separator orientation="vertical" className="h-5" />
        <DataTableRowActions
          label={t('table.bulkActions')}
          actions={actions.map((action) => ({ ...action, disabled: disabled || action.disabled }))}
        />
      </div>
    </div>
  )
}
