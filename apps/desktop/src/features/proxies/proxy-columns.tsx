import type { ColumnDef } from '@tanstack/react-table'
import { EllipsisIcon, LockKeyholeIcon } from 'lucide-react'
import type { I18nContextValue } from '@/i18n'
import type { ProxySummary } from '@/shared/types/app'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { selectionColumn } from '@/components/data-table/data-table-selection'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function proxyColumns({
  t,
  locale,
  usage,
  locked,
  onEdit,
  onDelete,
}: {
  t: I18nContextValue['t']
  locale: string
  usage: Map<string, number>
  locked: Set<string>
  onEdit: (proxy: ProxySummary) => void
  onDelete: (proxy: ProxySummary) => void
}): ColumnDef<DataTableFeatures, ProxySummary, unknown>[] {
  return [
    selectionColumn<ProxySummary>(t),
    {
      id: 'address',
      accessorFn: (row) => `${row.host}:${row.port} ${row.proxyId}`,
      header: t('proxy.address'),
      meta: { label: t('proxy.address') },
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
              {row.original.host}:{row.original.port}
            </span>
          </Button>
          <span className="max-w-full truncate text-xs text-muted-foreground" title={row.id}>
            {row.id}
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
      cell: ({ row }) => <Badge variant="outline">{row.original.type.toUpperCase()}</Badge>,
    },
    {
      id: 'auth',
      accessorFn: (row) => (row.hasPassword ? 'password' : row.username ? 'username' : 'none'),
      header: t('proxy.auth'),
      meta: { label: t('proxy.auth') },
      filterFn: 'isOneOf',
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-2 text-muted-foreground">
          {row.original.hasPassword && <LockKeyholeIcon className="size-3.5" />}
          {t(
            row.original.hasPassword
              ? 'proxy.passwordSet'
              : row.original.username
                ? 'proxy.usernameOnly'
                : 'proxy.noAuth',
          )}
        </span>
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
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      meta: { label: t('proxy.actions'), align: 'end' },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${t('proxy.actions')}: ${row.original.host}:${row.original.port}`}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={locked.has(row.id)}
                title={locked.has(row.id) ? t('proxy.inUse') : undefined}
                onClick={() => onEdit(row.original)}
              >
                {t('admin.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!!usage.get(row.id)}
                onClick={() => onDelete(row.original)}
              >
                {t('admin.delete')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
