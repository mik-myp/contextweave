import { useContext, useEffect, useState } from 'react'
import { useTable, type ColumnDef, type RowData, type TableState } from '@tanstack/react-table'
import { dataTableFeatures, type DataTableFeatures } from './data-table-features'
import { DataTableStateContext } from './data-table-state-context'

export function useDataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  stateKey,
  initialState,
  loading = false,
  enableRowSelection = false,
}: {
  data: TData[]
  columns: ReadonlyArray<ColumnDef<DataTableFeatures, TData, unknown>>
  getRowId: (row: TData) => string
  /** Unique per list. Omit for an ephemeral table. */
  stateKey?: string
  initialState?: Partial<TableState<DataTableFeatures>>
  loading?: boolean
  enableRowSelection?: boolean
}) {
  const snapshots = useContext(DataTableStateContext)
  const [startingState] = useState(() => ({
    pagination: { pageIndex: 0, pageSize: 20 },
    ...initialState,
    ...(stateKey ? snapshots?.get(stateKey)?.state : undefined),
  }))
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId,
    meta: { stateKey },
    globalFilterFn: 'includesString',
    defaultColumn: { sortFn: 'alphanumeric', filterFn: 'includesString' },
    initialState: { ...startingState, rowSelection: {} },
    autoResetPageIndex: false,
    enableRowSelection,
  })
  const pageCount = table.getPageCount()
  const { pageIndex } = table.state.pagination
  useEffect(() => {
    // Preserve a restored page while data is loading; clamp only against settled data.
    if (!loading && pageIndex >= pageCount && pageIndex > 0) {
      table.setPageIndex(Math.max(0, pageCount - 1))
    }
  }, [table, loading, pageIndex, pageCount])
  // Selection is transient and is pruned when a successful refresh removes a row.
  useEffect(() => {
    if (loading) return
    const ids = new Set(data.map(getRowId))
    if (Object.keys(table.state.rowSelection).some((id) => !ids.has(id)))
      table.setRowSelection((selection) =>
        Object.fromEntries(Object.entries(selection).filter(([id]) => ids.has(id))),
      )
  }, [data, getRowId, loading, table])
  const state = table.state
  useEffect(() => {
    if (stateKey && snapshots) {
      snapshots.set(stateKey, { ...snapshots.get(stateKey), state: { ...state, rowSelection: {} } })
    }
  }, [snapshots, stateKey, state])
  return table
}
