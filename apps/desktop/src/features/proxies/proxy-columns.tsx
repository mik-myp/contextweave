import type { ColumnDef } from '@tanstack/react-table'
import { LockKeyholeIcon, PencilIcon, Trash2Icon, WifiIcon } from 'lucide-react'
import type { I18nContextValue } from '@/i18n'
import type { ProxySummary } from '@/shared/types/app'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { selectionColumn } from '@/components/data-table/data-table-selection'
import { ProxyTestResult } from './components/proxy-test-result'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTableRowActions } from '@/components/data-table/data-table-row-actions'

export function proxyColumns({
  t,
  locale,
  usage,
  locked,
  onEdit,
  onDelete,
  onTest,
  testing,
  results,
}: {
  t: I18nContextValue['t']
  locale: string
  usage: Map<string, number>
  locked: Set<string>
  onEdit: (proxy: ProxySummary) => void
  onDelete: (proxy: ProxySummary) => void
  onTest: (proxy: ProxySummary) => void
  testing: Set<string>
  results: Record<string, import('@contextweave/contracts').ProxyTestResult>
}): ColumnDef<DataTableFeatures, ProxySummary, unknown>[] {
  return [
    selectionColumn<ProxySummary>(t),
    {
      id: 'address',
      accessorFn: (row) => `${row.name ?? ''} ${row.host}:${row.port} ${row.proxyId}`,
      header: t('proxy.name'),
      meta: { label: t('proxy.name') },
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex min-w-44 max-w-80 flex-col items-start gap-0.5">
          <Button
            size="sm"
            variant="link"
            className="h-auto max-w-full justify-start px-0 text-foreground"
            disabled={locked.has(row.id)}
            title={locked.has(row.id) ? t('proxy.inUse') : undefined}
            onClick={() => onEdit(row.original)}
          >
            <span className="truncate" dir="ltr">
              {row.original.name || `${row.original.host}:${row.original.port}`}
            </span>
          </Button>
          <span className="max-w-full truncate text-xs text-muted-foreground" title={row.id}>
            {row.original.host}:{row.original.port}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'type',
      header: t('proxy.type'),
      meta: { label: t('proxy.type') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.type === 'socks5'
              ? 'info'
              : row.original.type === 'https'
                ? 'success'
                : 'secondary'
          }
        >
          {row.original.type.toUpperCase()}
        </Badge>
      ),
    },
    {
      id: 'auth',
      accessorFn: (row) => (row.hasPassword ? 'password' : row.username ? 'username' : 'none'),
      header: t('proxy.auth'),
      meta: { label: t('proxy.auth') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <Badge variant={row.original.hasPassword ? 'success' : 'secondary'}>
          {row.original.hasPassword && <LockKeyholeIcon className="size-3.5" />}
          {t(
            row.original.hasPassword
              ? 'proxy.passwordSet'
              : row.original.username
                ? 'proxy.usernameOnly'
                : 'proxy.noAuth',
          )}
        </Badge>
      ),
    },
    {
      id: 'usage',
      accessorFn: (row) => usage.get(row.proxyId) ?? 0,
      header: t('proxy.usage'),
      meta: { label: t('proxy.usage') },
      enableGlobalFilter: false,
      cell: ({ row }) => <span className="tabular-nums">{usage.get(row.id) ?? 0}</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: t('proxy.updated'),
      meta: { label: t('proxy.updated') },
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <time
          dateTime={row.original.updatedAt}
          className="whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(row.original.updatedAt),
          )}
        </time>
      ),
    },
    {
      id: 'connection',
      header: t('proxy.connection'),
      meta: { label: t('proxy.connection') },
      enableSorting: false,
      cell: ({ row }) => (
        <ProxyTestResult result={results[`${row.id}:${row.original.updatedAt}`]} />
      ),
    },
    {
      id: 'actions',
      header: t('proxy.actions'),
      enableSorting: false,
      enableHiding: false,
      meta: { label: t('proxy.actions'), align: 'end' },
      cell: ({ row }) => (
        <DataTableRowActions
          label={`${t('proxy.actions')}: ${row.original.name ?? row.original.host}`}
          actions={[
            {
              id: 'test',
              label: t(testing.has(row.id) ? 'proxy.testing' : 'proxy.test'),
              icon: WifiIcon,
              pending: testing.has(row.id),
              disabled: testing.has(row.id),
              onClick: () => onTest(row.original),
            },
            {
              id: 'edit',
              label: t('admin.edit'),
              icon: PencilIcon,
              disabled: locked.has(row.id),
              disabledReason: t('proxy.inUse'),
              onClick: () => onEdit(row.original),
            },
            {
              id: 'delete',
              label: t('admin.delete'),
              icon: Trash2Icon,
              destructive: true,
              disabled: !!usage.get(row.id),
              disabledReason: t('proxy.unlinkBeforeDelete'),
              onClick: () => onDelete(row.original),
            },
          ]}
        />
      ),
    },
  ]
}
