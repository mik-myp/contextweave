import { useState } from 'react'
import { BatchPreviewDialog } from '../batches/batch-preview-dialog'
import { workspaceKey, useWorkspaceContext } from '@/features/workspaces/workspace-session-context'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { ArchiveRestoreIcon } from 'lucide-react'
import { DataTableRowActions } from '@/components/data-table/data-table-row-actions'
import { selectionColumn } from '@/components/data-table/data-table-selection'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { useDataTable } from '@/components/data-table/use-data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
const getRowId = (row: EnvironmentSummary) => row.id
export function EnvironmentTrash({ onCreated }: { onCreated: (id: string) => void }) {
  const workspaceContext = useWorkspaceContext()
  const workspaceApi = useWorkspaceApi()
  const { t, locale } = useI18n()
  const [targets, setTargets] = useState<EnvironmentSummary[]>()
  const query = useQuery({
    queryKey: workspaceKey(workspaceContext, 'environments', 'trash'),
    queryFn: () => unwrapIpc(workspaceApi.environment.trash()),
  })
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
      header: t('env.actions'),
      enableHiding: false,
      enableSorting: false,
      meta: { label: t('env.actions'), align: 'end' },
      cell: ({ row }) => (
        <DataTableRowActions
          label={`${t('env.actions')}: ${row.original.name}`}
          actions={[
            {
              id: 'restore',
              label: t('life.restore'),
              icon: ArchiveRestoreIcon,
              onClick: () => setTargets([row.original]),
            },
          ]}
        />
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Alert>
        <AlertDescription>{t('life.trashHelp')}</AlertDescription>
      </Alert>
      {targets && (
        <BatchPreviewDialog
          request={{ action: 'restore', environmentIds: targets.map((item) => item.id) }}
          onClose={() => setTargets(undefined)}
          onCreated={(id) => {
            table.resetRowSelection()
            onCreated(id)
          }}
        />
      )}
      <DataTable
        table={table}
        label={t('life.trash')}
        searchPlaceholder={t('env.search')}
        loading={query.isPending}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        emptyTitle={t('life.trashEmpty')}
        bulkActions={
          <DataTableBulkActions
            table={table}
            actions={[
              {
                id: 'restore',
                label: `${t('life.restore')} (${selected.length})`,
                icon: ArchiveRestoreIcon,
                disabled: !selected.length,
                onClick: () => setTargets(selected),
              },
            ]}
          />
        }
      />
    </div>
  )
}
