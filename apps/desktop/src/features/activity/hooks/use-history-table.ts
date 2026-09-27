import { workspaceKey, useWorkspaceContext } from '@/features/workspaces/workspace-session-context'
import { useContext, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  functionalUpdate,
  useTable,
  type ColumnDef,
  type RowData,
  type TableState,
} from '@tanstack/react-table'
import type { z } from 'zod'
import type { HistoryPage, HistoryQuery, IpcResult } from '@contextweave/contracts'
import { DataTableStateContext } from '@/components/data-table/data-table-state-context'
import {
  dataTableFeatures,
  type DataTableFeatures,
} from '@/components/data-table/data-table-features'
import { errorMessage } from '@/shared/lib/error-message'
import { unwrapIpc } from '@/shared/lib/ipc'
import { useI18n } from '@/i18n'

type View = Pick<TableState<DataTableFeatures>, 'sorting' | 'pagination' | 'columnFilters'> & {
  globalFilter: string
  cursor: string | null
}
export function useHistoryTable<T extends RowData, Q extends HistoryQuery>({
  domain,
  columns,
  getRowId,
  schema,
  loadPage,
}: {
  domain: 'activity' | 'operations'
  columns: ColumnDef<DataTableFeatures, T, unknown>[]
  getRowId: (row: T) => string
  schema: z.ZodType<Q>
  loadPage: (query: Q) => Promise<IpcResult<HistoryPage<T>>>
}) {
  const workspaceContext = useWorkspaceContext()
  const { t } = useI18n()
  const client = useQueryClient()
  const snapshots = useContext(DataTableStateContext)
  const [saved] = useState(() => snapshots?.get(domain))
  const [view, setView] = useState<View>(() => ({
    sorting: saved?.state?.sorting ?? [{ id: 'startedAt', desc: true }],
    pagination: { pageIndex: 0, pageSize: saved?.state?.pagination?.pageSize ?? 20 },
    globalFilter: String(saved?.state?.globalFilter ?? ''),
    columnFilters: saved?.state?.columnFilters ?? [],
    cursor: saved?.pageCursor ?? null,
  }))
  const [cancelledKey, setCancelledKey] = useState<string | null>(null)
  const request = {
    limit: view.pagination.pageSize,
    search: view.globalFilter,
    sortBy: view.sorting[0]?.id ?? 'startedAt',
    direction: view.sorting[0]?.desc === false ? 'asc' : 'desc',
    statuses: view.columnFilters.find((filter) => filter.id === 'status')?.value ?? [],
    cursor: view.cursor,
  }
  const requestKey = JSON.stringify(request)
  const queryKey = workspaceKey(workspaceContext, domain, 'page', request)
  const updateView = (updater: (value: View) => View) => {
    setCancelledKey(null)
    if (snapshots) snapshots.set(domain, { ...snapshots.get(domain), scrollTop: 0 })
    setView(updater)
  }
  const cancelled = cancelledKey === requestKey
  const query = useQuery({
    queryKey,
    // A page is live, not an accumulated history cache. Unobserved requests are cancellable.
    gcTime: 0,
    enabled: !cancelled,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const parsed = schema.safeParse(request)
      if (!parsed.success) throw new Error(errorMessage('INVALID_INPUT'))
      const page = await unwrapIpc(loadPage(parsed.data))
      // Electron invoke itself is not interruptible. Never accept a superseded response.
      signal.throwIfAborted()
      return page
    },
  })
  const table = useTable({
    features: dataTableFeatures,
    columns,
    // A failed revalidation can mean the cursor was deleted by explicit history cleanup.
    // Do not keep showing an obsolete successful page under an error.
    data: query.isError || cancelled ? [] : (query.data?.items ?? []),
    getRowId,
    meta: { stateKey: domain },
    initialState: { ...saved?.state, rowSelection: {} },
    state: {
      sorting: view.sorting,
      pagination: view.pagination,
      globalFilter: view.globalFilter,
      columnFilters: view.columnFilters,
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    autoResetPageIndex: false,
    enableMultiSort: false,
    pageCount: -1,
    onSortingChange: (updater) =>
      updateView((value) => ({
        ...value,
        sorting: functionalUpdate(updater, value.sorting),
        cursor: null,
      })),
    onGlobalFilterChange: (updater) =>
      updateView((value) => ({
        ...value,
        globalFilter: String(functionalUpdate(updater, value.globalFilter)),
        cursor: null,
      })),
    onColumnFiltersChange: (updater) =>
      updateView((value) => ({
        ...value,
        columnFilters: functionalUpdate(updater, value.columnFilters),
        cursor: null,
      })),
    onPaginationChange: (updater) =>
      updateView((value) => ({
        ...value,
        pagination: { ...functionalUpdate(updater, value.pagination), pageIndex: 0 },
        cursor: null,
      })),
  })
  const state = table.state
  useEffect(() => {
    snapshots?.set(domain, {
      ...snapshots.get(domain),
      state: { ...state, rowSelection: {} },
      pageCursor: view.cursor,
    })
  }, [domain, snapshots, state, view.cursor])

  const retry = () => {
    setCancelledKey(null)
    void query.refetch()
  }
  return {
    table,
    loading: query.isFetching,
    error: cancelled ? t('history.cancelled') : query.error?.message,
    retry,
    cancel: () => {
      setCancelledKey(requestKey)
      void client.cancelQueries({ queryKey, exact: true })
    },
    first: () => {
      updateView((value) => ({ ...value, cursor: null }))
      if (view.cursor === null) void query.refetch()
    },
    previous: () => {
      const cursor = query.data?.previousCursor
      if (cursor) updateView((value) => ({ ...value, cursor }))
    },
    next: () => {
      const cursor = query.data?.nextCursor
      if (cursor) updateView((value) => ({ ...value, cursor }))
    },
    hasPrevious: !query.isError && !cancelled && Boolean(query.data?.previousCursor),
    hasNext: !query.isError && !cancelled && Boolean(query.data?.nextCursor),
  }
}
