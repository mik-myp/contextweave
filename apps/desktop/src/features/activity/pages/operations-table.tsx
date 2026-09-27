import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { operationHistoryQuerySchema, type OperationSummary } from '@contextweave/contracts'
import { useI18n, type TranslationKey } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'
import { DataTable } from '@/components/data-table/data-table'
import { useHistoryTable } from '../hooks/use-history-table'
import { HistoryPagination } from '../components/history-pagination'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Badge } from '@/components/ui/badge'
const getRowId = (row: OperationSummary) => row.operationId
export function OperationsTable() {
  const workspaceApi = useWorkspaceApi()
  const { t, locale } = useI18n()
  const columns = useMemo<ColumnDef<DataTableFeatures, OperationSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'kind',
        header: t('life.kind'),
        meta: { label: t('life.kind') },
        cell: ({ row }) => t(`life.op.${row.original.kind}`),
      },
      {
        id: 'environmentId',
        accessorFn: (row) => `${row.environmentName ?? ''} ${row.environmentId ?? ''}`,
        header: t('env.name'),
        meta: { label: t('env.name') },
        cell: ({ row }) => (
          <span className="block max-w-48 truncate" title={row.original.environmentId ?? undefined}>
            {row.original.environmentName ?? row.original.environmentId ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('life.result'),
        meta: { label: t('life.result') },
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'failed'
                ? 'destructive'
                : row.original.status === 'succeeded'
                  ? 'success'
                  : 'secondary'
            }
          >
            {t(`life.result.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        accessorKey: 'phase',
        header: t('life.phase'),
        meta: { label: t('life.phase') },
        cell: ({ row }) =>
          t(`life.phase.${row.original.phase}` as TranslationKey) ?? row.original.phase,
      },
      ...(['startedAt', 'endedAt'] as const).map((key) => ({
        accessorKey: key,
        header: t(`life.${key}`),
        meta: { label: t(`life.${key}`) },
        cell: ({ row }: { row: { original: OperationSummary } }) =>
          row.original[key] ? new Date(row.original[key]).toLocaleString(locale) : '—',
      })),
      {
        accessorKey: 'errorCode',
        header: t('activity.reason'),
        meta: { label: t('activity.reason') },
        cell: ({ row }) => (row.original.errorCode ? errorMessage(row.original.errorCode) : '—'),
      },
    ],
    [t, locale],
  )
  const history = useHistoryTable({
    domain: 'operations',
    schema: operationHistoryQuerySchema,
    loadPage: (query) => workspaceApi.operation.page(query),
    columns,
    getRowId,
  })
  return (
    <DataTable
      table={history.table}
      label={t('life.operations')}
      searchPlaceholder={t('common.search')}
      loading={history.loading}
      error={history.error}
      onRetry={history.retry}
      searchMaxLength={200}
      pagination={<HistoryPagination history={history} />}
    />
  )
}
