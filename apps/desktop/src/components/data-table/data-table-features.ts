import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  filterFn_equalsString,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'
import { filterIsOneOf } from './data-table-filter-functions'

// Shared v9 features. Each feature decides which rows and actions are eligible.
export const dataTableFeatures = tableFeatures({
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
    isOneOf: filterIsOneOf,
  },
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  // TanStack v9 uses phantom metadata types to infer column/table options.
  columnMeta: {} as { label: string; align?: 'start' | 'end' },
  tableMeta: {} as { stateKey?: string },
})
export type DataTableFeatures = typeof dataTableFeatures
