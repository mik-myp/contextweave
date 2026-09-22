import { createColumnHelper } from '@tanstack/react-table'
import type { ProxySummary } from '@/shared/types/app'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Badge } from '@/components/ui/badge'
import { ProxyRowActions } from './proxy-row-actions'

const helper = createColumnHelper<DataTableFeatures, ProxySummary>()
export function proxyColumns({
  onEdit,
  onDelete,
}: {
  onEdit: (row: ProxySummary) => void
  onDelete: (row: ProxySummary) => void
}) {
  return helper.columns([
    helper.accessor((row) => `${row.host}:${row.port}`, {
      id: 'address',
      header: '代理地址',
      meta: { label: '代理地址' },
      enableHiding: false,
    }),
    helper.accessor('type', {
      header: '类型',
      meta: { label: '类型' },
      cell: ({ row }) => <Badge variant="outline">{row.original.type.toUpperCase()}</Badge>,
    }),
    helper.accessor((row) => row.username ?? '无认证', {
      id: 'username',
      header: '认证',
      meta: { label: '认证' },
    }),
    helper.display({
      id: 'actions',
      header: '操作',
      meta: { label: '操作', align: 'end' },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <ProxyRowActions proxy={row.original} onEdit={onEdit} onDelete={onDelete} />
      ),
    }),
  ])
}
