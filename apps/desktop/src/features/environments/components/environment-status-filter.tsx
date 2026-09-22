import type { ReactTable } from '@tanstack/react-table'
import { environmentStatusSchema, type EnvironmentSummary } from '@contextweave/contracts'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { statusLabel } from '@/shared/lib/environment'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'

const items = [
  { value: 'all', label: '全部状态' },
  ...environmentStatusSchema.options.map((value) => ({ value, label: statusLabel(value) })),
]
export function EnvironmentStatusFilter({
  table,
}: {
  table: ReactTable<DataTableFeatures, EnvironmentSummary>
}) {
  const column = table.getColumn('status')
  return (
    <Select
      items={items}
      value={String(column?.getFilterValue() ?? 'all')}
      onValueChange={(value) => {
        column?.setFilterValue(value === 'all' ? undefined : value)
        table.setPageIndex(0)
      }}
    >
      <SelectTrigger className="h-8 w-28" aria-label="环境状态">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
