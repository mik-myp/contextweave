import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import type { ActivitySummary } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableFilter } from '@/components/data-table/data-table-filter'
import { useDataTable } from '@/components/data-table/use-data-table'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Badge } from '@/components/ui/badge'
const getRowId = (row: ActivitySummary) => row.sessionId
const statuses = ['starting', 'running', 'stopping', 'stopped', 'crashed'] as const
export function ActivityPage() {
  const { t, locale } = useI18n()
  const { activity, loading, activityError, refresh } = useAppData()
  const columns = useMemo<ColumnDef<DataTableFeatures, ActivitySummary, unknown>[]>(
    () => [
      {
        id: 'environment',
        accessorFn: (row) => `${row.environmentName ?? ''} ${row.environmentId} ${row.sessionId}`,
        header: t('activity.environment'),
        meta: { label: t('activity.environment') },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-40 max-w-72 flex-col gap-0.5">
            {row.original.environmentName ? (
              <Link
                to="/environments/$environmentId/edit"
                params={{ environmentId: row.original.environmentId }}
                className="truncate font-medium hover:underline"
              >
                {row.original.environmentName}
              </Link>
            ) : (
              <span>{t('activity.removed')}</span>
            )}
            <span
              className="truncate text-xs text-muted-foreground"
              title={row.original.environmentId}
            >
              {row.original.environmentId}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('activity.status'),
        meta: { label: t('activity.status') },
        filterFn: 'isOneOf',
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'crashed'
                ? 'destructive'
                : row.original.status === 'running'
                  ? 'success'
                  : 'outline'
            }
          >
            {t(
              row.original.status === 'crashed'
                ? 'activity.crashed'
                : `status.${row.original.status}`,
            )}
          </Badge>
        ),
      },
      {
        accessorKey: 'startedAt',
        header: t('activity.started'),
        meta: { label: t('activity.started') },
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <time
            dateTime={row.original.startedAt}
            className="whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(
              new Date(row.original.startedAt),
            )}
          </time>
        ),
      },
      {
        accessorKey: 'sessionId',
        header: t('activity.session'),
        meta: { label: t('activity.session') },
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <span
            className="block max-w-44 truncate font-mono text-xs text-muted-foreground"
            title={row.id}
          >
            {row.id}
          </span>
        ),
      },
      {
        accessorKey: 'exitReason',
        header: t('activity.reason'),
        meta: { label: t('activity.reason') },
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <span
            className="block max-w-80 truncate text-muted-foreground"
            title={row.original.exitReason ?? undefined}
          >
            {row.original.exitReason ?? '—'}
          </span>
        ),
      },
    ],
    [t, locale],
  )
  const table = useDataTable({
    data: activity,
    columns,
    getRowId,
    stateKey: 'activity',
    loading,
    initialState: { sorting: [{ id: 'startedAt', desc: true }] },
  })
  return (
    <>
      <h1 className="sr-only">{t('activity.list')}</h1>
      <DataTable
        table={table}
        label={t('activity.list')}
        searchPlaceholder={t('activity.search')}
        loading={loading}
        error={activityError}
        onRetry={() => void refresh()}
        emptyTitle={t('activity.empty')}
        emptyDescription={t('activity.emptyDescription')}
        filters={
          <DataTableFilter
            column={table.getColumn('status')}
            label={t('activity.status')}
            options={statuses.map((value) => ({
              value,
              label: t(value === 'crashed' ? 'activity.crashed' : `status.${value}`),
            }))}
            onFilterChange={() => table.setPageIndex(0)}
          />
        }
      />
    </>
  )
}
