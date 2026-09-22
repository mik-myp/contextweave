import { useEffect } from 'react'
import { useTable, type ColumnDef, type RowData } from '@tanstack/react-table'
import { dataTableFeatures, type DataTableFeatures } from './data-table-features'

export function useDataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
}: {
  data: TData[]
  columns: ReadonlyArray<ColumnDef<DataTableFeatures, TData, unknown>>
  getRowId: (row: TData) => string
}) {
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId,
    globalFilterFn: 'includesString',
    defaultColumn: { sortFn: 'alphanumeric', filterFn: 'includesString' },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  })
  const pageCount = table.getPageCount()
  const pageIndex = table.state.pagination.pageIndex
  useEffect(() => {
    // A deletion or refreshed data may remove the current last page.
    if (pageIndex >= pageCount && pageIndex > 0) table.setPageIndex(Math.max(0, pageCount - 1))
  }, [table, pageIndex, pageCount])
  return table
}
