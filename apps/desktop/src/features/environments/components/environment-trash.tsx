import { selectionColumn } from '@/components/data-table/data-table-selection'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { useBatchMutation } from '@/shared/hooks/use-batch-mutation'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { useDataTable } from '@/components/data-table/use-data-table'
import { BatchResult } from '@/components/batch-result'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
const getRowId = (row: EnvironmentSummary) => row.id
export function EnvironmentTrash() {
  const { t, locale } = useI18n()
  const batch = useBatchMutation(['environments'])
  const query = useQuery({
    queryKey: ['local', 'environments', 'trash'],
    queryFn: () => unwrapIpc(window.contextweave.environment.trash()),
  })
  const restore = async (items: EnvironmentSummary[]) => {
    const result = await batch.run({
      items,
      getId: (row) => row.id,
      getLabel: (row) => row.name,
      action: (row) => unwrapIpc(window.contextweave.environment.restore(row.id)),
    })
    if (result)
      table.setRowSelection((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !result.succeeded.includes(id)),
        ),
      )
  }
  const columns: ColumnDef<DataTableFeatures, EnvironmentSummary, unknown>[] = [
    selectionColumn<EnvironmentSummary>(t),
    {
      accessorKey: 'name',
      header: t('env.name'),
      meta: { label: t('env.name') },
      enableHiding: false,
    },
    { accessorKey: 'kernelId', header: t('env.kernel'), meta: { label: t('env.kernel') } },
    {
      accessorKey: 'trashedAt',
      header: t('life.trashedAt'),
      meta: { label: t('life.trashedAt') },
      cell: ({ row }) =>
        row.original.trashedAt ? new Date(row.original.trashedAt).toLocaleString(locale) : '—',
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      enableSorting: false,
      meta: { label: t('env.actions'), align: 'end' },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={batch.pending}
          onClick={() => void restore([row.original])}
        >
          {t('life.restore')}
        </Button>
      ),
    },
  ]
  const table = useDataTable({
    data: query.data ?? [],
    columns,
    getRowId,
    stateKey: 'environment-trash',
    enableRowSelection: true,
    loading: query.isPending,
    initialState: { sorting: [{ id: 'trashedAt', desc: true }] },
  })
  const selected = table.getFilteredSelectedRowModel().rows.map((row) => row.original)
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>{t('life.trashHelp')}</AlertDescription>
      </Alert>
      <BatchResult failures={batch.failures} />
      <DataTable
        table={table}
        label={t('life.trash')}
        searchPlaceholder={t('env.search')}
        loading={query.isPending}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        emptyTitle={t('life.trashEmpty')}
        bulkActions={
          <DataTableBulkActions table={table} disabled={batch.pending}>
            <Button
              size="sm"
              variant="outline"
              disabled={batch.pending || !selected.length}
              onClick={() => void restore(selected)}
            >
              {t('life.restore')} ({selected.length})
            </Button>
          </DataTableBulkActions>
        }
      />
    </div>
  )
}
