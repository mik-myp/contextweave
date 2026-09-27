import { environmentViewSchema, type EnvironmentView } from '@contextweave/contracts'
import type { ReactTable } from '@tanstack/react-table'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { getFilterValues } from '@/components/data-table/data-table-filter-functions'
import type { OrganizedEnvironment } from './use-organization'

export function captureEnvironmentView(
  table: ReactTable<DataTableFeatures, OrganizedEnvironment>,
): EnvironmentView {
  const filter = (id: string) =>
    getFilterValues(table.state.columnFilters.find((item) => item.id === id)?.value)
  return environmentViewSchema.parse({
    version: 1,
    search: String(table.state.globalFilter ?? ''),
    filters: {
      statuses: filter('status'),
      kernelIds: filter('kernelId'),
      proxyIds: filter('proxyId'),
      groupIds: filter('groupId'),
      tags: filter('tags'),
    },
    sorting: table.state.sorting,
    hiddenColumns: table
      .getAllLeafColumns()
      .filter((column) => column.getCanHide() && !column.getIsVisible())
      .map((column) => column.id),
  })
}
export function applyEnvironmentView(
  table: ReactTable<DataTableFeatures, OrganizedEnvironment>,
  input: EnvironmentView,
) {
  const view = environmentViewSchema.parse(input)
  table.setGlobalFilter(view.search)
  table.setSorting(view.sorting)
  table.setColumnFilters(
    [
      { id: 'status', value: view.filters.statuses },
      { id: 'kernelId', value: view.filters.kernelIds },
      { id: 'proxyId', value: view.filters.proxyIds },
      { id: 'groupId', value: view.filters.groupIds },
      { id: 'tags', value: view.filters.tags },
    ].filter((item) => item.value.length > 0),
  )
  table.setColumnVisibility(Object.fromEntries(view.hiddenColumns.map((id) => [id, false])))
  table.setRowSelection({})
  table.setPageIndex(0)
}
