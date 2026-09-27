import { selectionColumn } from '@/components/data-table/data-table-selection'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { organizationNameKey } from '@contextweave/contracts'
import type { OrganizedEnvironment } from './organization/use-organization'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Badge } from '@/components/ui/badge'
import { CircleIcon, CircleCheckIcon, CircleAlertIcon, ClockIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusVariant } from '@/shared/lib/environment'
import type { KernelSummary, ProxySummary } from '@/shared/types/app'
import type { I18nContextValue } from '@/i18n'
import { EnvironmentRowActions } from './components/environment-row-actions'

export function environmentColumns({
  t,
  locale,
  kernels,
  proxies,
  pending,
  onStart,
  onStop,
  onDelete,
  onOrganize,
}: {
  t: I18nContextValue['t']
  locale: string
  kernels: KernelSummary[]
  proxies: ProxySummary[]
  pending: ReadonlySet<string>
  onStart: (environment: OrganizedEnvironment) => void
  onStop: (environment: OrganizedEnvironment) => void
  onOrganize: (environment: OrganizedEnvironment) => void
  onDelete: (environment: OrganizedEnvironment) => void
}): ColumnDef<DataTableFeatures, OrganizedEnvironment, unknown>[] {
  return [
    selectionColumn<OrganizedEnvironment>(t),
    {
      id: 'name',
      accessorFn: (row) => `${row.name} ${row.id} ${row.groupName}`,
      header: t('env.name'),
      meta: { label: t('env.name') },
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex min-w-48 max-w-80 flex-col items-start gap-0.5">
          <Link
            className="max-w-full rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            to="/environments/$environmentId/edit"
            params={{ environmentId: row.original.id }}
          >
            <span className="block truncate">{row.original.name}</span>
          </Link>
          <span
            className="max-w-full truncate text-[0.8125rem] text-muted-foreground"
            title={row.original.id}
          >
            {row.original.id}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: t('env.status'),
      meta: { label: t('env.status') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => {
        const status = row.original.status
        const Icon =
          status === 'running'
            ? CircleCheckIcon
            : status === 'error' || status === 'needs-recovery'
              ? CircleAlertIcon
              : status === 'starting' || status === 'stopping'
                ? ClockIcon
                : CircleIcon
        return (
          <Badge variant={statusVariant(status)}>
            <Icon aria-hidden="true" data-icon="inline-start" />
            {t(`status.${status}`)}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'kernelId',
      header: t('env.kernel'),
      meta: { label: t('env.kernel') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span>
            {kernels.find((kernel) => kernel.id === row.original.kernelId)?.label ??
              row.original.kernelId}
          </span>
          <span className="text-[0.8125rem] text-muted-foreground">
            {row.original.kernelVersion === 'local'
              ? t('env.localKernel')
              : row.original.kernelVersion}
          </span>
        </div>
      ),
    },
    {
      id: 'proxyId',
      accessorFn: (row) => row.proxyId ?? 'direct',
      header: t('env.proxy'),
      meta: { label: t('env.proxy') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => {
        const proxy = proxies.find((item) => item.proxyId === row.original.proxyId)
        return (
          <span
            className={cn(
              'block max-w-56 truncate',
              !row.original.proxyId && 'text-muted-foreground',
            )}
            dir="auto"
          >
            {proxy ? `${proxy.host}:${proxy.port}` : (row.original.proxyId ?? t('env.direct'))}
          </span>
        )
      },
    },
    {
      id: 'groupId',
      accessorFn: (row) => row.groupId ?? 'ungrouped',
      header: t('org.group'),
      meta: { label: t('org.group') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <span className="block max-w-40 truncate" title={row.original.groupName}>
          {row.original.groupName || t('org.ungrouped')}
        </span>
      ),
    },
    {
      id: 'tags',
      accessorFn: (row) => row.tags.map(organizationNameKey),
      header: t('org.tags'),
      meta: { label: t('org.tags') },
      filterFn: 'hasAny',
      cell: ({ row }) => (
        <div className="flex max-w-64 flex-wrap gap-1">
          {row.original.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="max-w-full truncate" title={tag}>
              {tag}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: 'note',
      header: t('org.note'),
      meta: { label: t('org.note') },
      cell: ({ row }) => (
        <span className="block max-w-64 truncate" title={row.original.note}>
          {row.original.note}
        </span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('env.updated'),
      meta: { label: t('env.updated') },
      enableGlobalFilter: false,
      sortFn: 'text',
      cell: ({ row }) => (
        <time
          dateTime={row.original.updatedAt}
          className="whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(row.original.updatedAt))}
        </time>
      ),
    },
    {
      id: 'actions',
      header: t('env.actions'),
      meta: { label: t('env.actions'), align: 'end' },
      enableSorting: false,
      enableHiding: false,
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <EnvironmentRowActions
          environment={row.original}
          pending={pending.has(row.id)}
          onStart={() => onStart(row.original)}
          onStop={() => onStop(row.original)}
          onDelete={() => onDelete(row.original)}
          onOrganize={() => onOrganize(row.original)}
        />
      ),
    },
  ]
}
