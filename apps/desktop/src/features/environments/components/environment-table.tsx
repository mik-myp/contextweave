import { useMemo } from 'react'
import { PlusIcon, RefreshCwIcon } from 'lucide-react'
import type { EnvironmentSummary } from '@contextweave/contracts'
import type { ProxySummary } from '@/shared/types/app'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { useDataTable } from '@/components/data-table/use-data-table'
import { environmentColumns } from './environment-columns'
import { EnvironmentStatusFilter } from './environment-status-filter'

export function EnvironmentTable({
  environments,
  proxies,
  selectedEnvironment,
  onSelect,
  canManage,
  onEdit,
  onDelete,
  onCreate,
  onRefresh,
  loading,
}: {
  environments: EnvironmentSummary[]
  proxies: ProxySummary[]
  selectedEnvironment?: string
  onSelect: (id: string) => void
  canManage: (row: EnvironmentSummary) => boolean
  onEdit: (row: EnvironmentSummary) => void
  onDelete: (row: EnvironmentSummary) => void
  onCreate: () => void
  onRefresh: () => void
  loading?: boolean
}) {
  const columns = useMemo(
    () => environmentColumns({ proxies, onSelect, canManage, onEdit, onDelete }),
    [proxies, onSelect, canManage, onEdit, onDelete],
  )
  const table = useDataTable({ data: environments, columns, getRowId: (row) => row.id })
  return (
    <DataTable
      table={table}
      label="环境列表"
      searchPlaceholder="搜索环境、内核或代理"
      selectedRowId={selectedEnvironment}
      loading={loading}
      filters={<EnvironmentStatusFilter table={table} />}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
          <Button size="sm" onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            新建环境
          </Button>
        </>
      }
      emptyTitle={environments.length ? '没有匹配的环境' : '暂无环境'}
      emptyDescription={
        environments.length
          ? '调整搜索或状态筛选条件后重试。'
          : '创建一个本地环境后，它会出现在这里。'
      }
    />
  )
}
