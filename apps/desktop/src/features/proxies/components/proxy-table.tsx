import { useMemo } from 'react'
import { PlusIcon, RefreshCwIcon } from 'lucide-react'
import type { ProxySummary } from '@/shared/types/app'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { useDataTable } from '@/components/data-table/use-data-table'
import { proxyColumns } from './proxy-columns'

export function ProxyTable({
  proxies,
  onEdit,
  onDelete,
  onCreate,
  onRefresh,
  loading,
}: {
  proxies: ProxySummary[]
  onEdit: (row: ProxySummary) => void
  onDelete: (row: ProxySummary) => void
  onCreate: () => void
  onRefresh: () => void
  loading?: boolean
}) {
  const columns = useMemo(() => proxyColumns({ onEdit, onDelete }), [onEdit, onDelete])
  const table = useDataTable({ data: proxies, columns, getRowId: (row) => row.proxyId })
  return (
    <DataTable
      table={table}
      label="代理列表"
      searchPlaceholder="搜索地址、类型或用户名"
      loading={loading}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
          <Button size="sm" onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            新建代理
          </Button>
        </>
      }
      emptyTitle={proxies.length ? '没有匹配的代理' : '暂无代理'}
      emptyDescription={
        proxies.length ? '调整搜索条件后重试。' : '添加代理后，可以在环境创建或编辑时绑定。'
      }
    />
  )
}
