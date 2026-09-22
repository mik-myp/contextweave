import { createColumnHelper } from '@tanstack/react-table'
import type { EnvironmentSummary } from '@contextweave/contracts'
import type { ProxySummary } from '@/shared/types/app'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { statusLabel, statusVariant } from '@/shared/lib/environment'
import { EnvironmentRowActions } from './environment-row-actions'

const helper = createColumnHelper<DataTableFeatures, EnvironmentSummary>()
export function environmentColumns({
  proxies,
  onSelect,
  onEdit,
  onDelete,
  canManage,
}: {
  proxies: ProxySummary[]
  onSelect: (id: string) => void
  onEdit: (row: EnvironmentSummary) => void
  onDelete: (row: EnvironmentSummary) => void
  canManage: (row: EnvironmentSummary) => boolean
}) {
  return helper.columns([
    helper.accessor('name', {
      header: '环境名称',
      meta: { label: '环境名称' },
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          variant="link"
          onClick={() => onSelect(row.original.id)}
          aria-label={`选择环境：${row.original.name}`}
        >
          {row.original.name}
        </Button>
      ),
    }),
    helper.accessor('status', {
      header: '状态',
      meta: { label: '状态' },
      filterFn: 'equalsString',
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.status)}>
          {statusLabel(row.original.status)}
        </Badge>
      ),
    }),
    helper.accessor((row) => `${row.kernelId} · ${row.kernelVersion}`, {
      id: 'kernel',
      header: '内核',
      meta: { label: '内核' },
    }),
    helper.accessor(
      (row) =>
        row.proxyId
          ? (proxies.find((proxy) => proxy.proxyId === row.proxyId)?.host ?? '已绑定')
          : '未使用',
      { id: 'proxy', header: '代理', meta: { label: '代理' } },
    ),
    helper.accessor((row) => `${row.platform}/${row.arch}`, {
      id: 'platform',
      header: '平台',
      meta: { label: '平台' },
    }),
    helper.display({
      id: 'actions',
      header: '操作',
      enableHiding: false,
      enableSorting: false,
      meta: { label: '操作', align: 'end' },
      cell: ({ row }) => (
        <EnvironmentRowActions
          item={row.original}
          canManage={canManage}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ),
    }),
  ])
}
