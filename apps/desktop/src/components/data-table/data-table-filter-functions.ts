import { constructFilterFn } from '@tanstack/react-table'

/** Accept earlier single-value session snapshots as a one-item selection. */
export function getFilterValues(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

export const filterIsOneOf = constructFilterFn({
  resolveFilterValue: getFilterValues,
  autoRemove: (value: unknown) => getFilterValues(value).length === 0,
  filter: (value: unknown, selected: string[]) => selected.includes(String(value ?? '')),
})
