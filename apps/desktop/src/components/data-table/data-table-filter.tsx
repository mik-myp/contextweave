// Adapted from shadcn-admin (MIT); see THIRD_PARTY_NOTICES.md.
import type { ComponentType } from 'react'
import type { Column, RowData } from '@tanstack/react-table'
import { CheckIcon, CirclePlusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { getFilterValues } from './data-table-filter-functions'
import type { DataTableFeatures } from './data-table-features'

export type DataTableFilterOption = {
  value: string
  label: string
  icon?: ComponentType<{ className?: string }>
}

/** Facet options and labels belong to the feature; selection and counts are shared. */
export function DataTableFilter<TData extends RowData>({
  column,
  label,
  options,
  onFilterChange,
}: {
  column: Column<DataTableFeatures, TData> | undefined
  label: string
  options: DataTableFilterOption[]
  onFilterChange: () => void
}) {
  const { t } = useI18n()
  if (!column) return null
  const selected = new Set(getFilterValues(column.getFilterValue()))
  // Keep a removed option visible while selected, so a restored filter can be cleared.
  const choices = [
    ...options,
    ...[...selected]
      .filter((value) => !options.some((option) => option.value === value))
      .map((value) => ({ value, label: value })),
  ]
  const selectedOptions = choices.filter((option) => selected.has(option.value))
  const counts = column.getFacetedUniqueValues()
  const selectionLabel = t('table.selectedCount').replace('{count}', String(selected.size))
  const update = (values: string[]) => {
    column.setFilterValue(values.length ? values : undefined)
    onFilterChange()
  }
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="max-w-full border-dashed" />}
        aria-label={selected.size ? `${label}, ${selectionLabel}` : label}
      >
        <CirclePlusIcon data-icon="inline-start" />
        {label}
        {selected.size > 0 && (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-4" />
            <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
              {selected.size}
            </Badge>
            <span className="hidden min-w-0 items-center gap-1 lg:flex">
              {selected.size > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                  {selectionLabel}
                </Badge>
              ) : (
                selectedOptions.map((option) => (
                  <Badge
                    key={option.value}
                    variant="secondary"
                    className="min-w-0 rounded-sm px-1 font-normal"
                  >
                    <span className="max-w-28 truncate" title={option.label}>
                      {option.label}
                    </span>
                  </Badge>
                ))
              )}
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-50 max-w-[calc(100vw-2rem)] p-0">
        <PopoverTitle className="sr-only">
          {t('table.filterTitle').replace('{label}', label)}
        </PopoverTitle>
        <Command label={t('table.searchFilter').replace('{label}', label)}>
          <CommandInput placeholder={label} />
          <CommandList label={label}>
            <CommandEmpty>{t('common.noResults')}</CommandEmpty>
            <CommandGroup>
              {choices.map((option: DataTableFilterOption) => {
                const checked = selected.has(option.value)
                const Icon = option.icon
                const count = counts.get(option.value) ?? 0
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    aria-label={`${option.label}, ${t('table.optionCount').replace('{count}', String(count))}, ${t(checked ? 'table.selected' : 'table.notSelected')}`}
                    onSelect={() => {
                      const next = new Set(selected)
                      if (checked) next.delete(option.value)
                      else next.add(option.value)
                      update([...next])
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                        checked
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible',
                      )}
                    >
                      <CheckIcon className="size-4" />
                    </span>
                    {Icon && <Icon className="text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate" title={option.label}>
                      {option.label}
                    </span>
                    {count > 0 && (
                      <span
                        aria-hidden="true"
                        className="ms-auto flex h-4 min-w-4 items-center justify-center font-mono text-xs"
                      >
                        {count}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator aria-hidden="true" />
                <CommandGroup>
                  <CommandItem
                    value="__clear_filters__"
                    onSelect={() => update([])}
                    className="justify-center text-center"
                  >
                    {t('table.clearFilter')}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
