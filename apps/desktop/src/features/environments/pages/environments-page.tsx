import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { BatchResult } from '@/components/batch-result'
import { useBatchMutation } from '@/shared/hooks/use-batch-mutation'
import { environmentService, isEnvironmentReadOnly } from '../environment-service'
import { useMemo, useState, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { environmentStatusSchema, type EnvironmentSummary } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { useAppData } from '@/app/use-app-data'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableFilter } from '@/components/data-table/data-table-filter'
import { useDataTable } from '@/components/data-table/use-data-table'
import { environmentColumns } from '../environment-columns'
import { useEnvironmentActions } from '../hooks/use-environment-actions'
import { EnvironmentConfirmDialog } from '../components/environment-confirm-dialog'
import { useEnvironmentDrafts } from '../environment-draft-context'

const getRowId = (row: EnvironmentSummary) => row.id

export function EnvironmentsPage() {
  const { t, locale } = useI18n()
  const { environments, kernels, proxies, loading, error, refresh } = useAppData()
  const actions = useEnvironmentActions()
  const batch = useBatchMutation()
  const [target, setTarget] = useState<{
    action: 'start' | 'stop' | 'delete'
    items: EnvironmentSummary[]
  }>()
  const onDelete = useCallback(
    (item: EnvironmentSummary) => setTarget({ action: 'delete', items: [item] }),
    [],
  )
  const { savedId, setSavedId } = useEnvironmentDrafts()
  const { pending, start, setStopTarget } = actions
  const columns = useMemo(
    () =>
      environmentColumns({
        t,
        locale,
        kernels,
        proxies,
        pending,
        onStart: start,
        onStop: setStopTarget,
        onDelete,
      }),
    [t, locale, kernels, proxies, pending, start, setStopTarget, onDelete],
  )
  const table = useDataTable({
    data: environments,
    columns,
    getRowId,
    stateKey: 'environments',
    enableRowSelection: true,
    loading,
    initialState: { sorting: [{ id: 'updatedAt', desc: true }] },
  })
  const selected = table.getFilteredSelectedRowModel().rows.map((row) => row.original)
  const eligible = {
    start: selected.filter((row) => ['created', 'ready', 'stopped', 'error'].includes(row.status)),
    stop: selected.filter((row) => row.status === 'running'),
    delete: selected.filter((row) => !isEnvironmentReadOnly(row.status)),
  }
  const confirmBatch = async () => {
    if (!target) return
    const result = await batch.run({
      items: target.items,
      getId: (row) => row.id,
      getLabel: (row) => row.name,
      action: (row) => environmentService[target.action](row.id),
    })
    if (result)
      table.setRowSelection((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !result.succeeded.includes(id)),
        ),
      )
    setTarget(undefined)
  }
  const filtered = Boolean(table.state.globalFilter) || table.state.columnFilters.length > 0
  const reset = () => {
    table.setGlobalFilter('')
    table.setColumnFilters([])
    table.setPageIndex(0)
  }
  const newAction = (
    <Button size="sm" render={<Link to="/environments/new" />}>
      <PlusIcon data-icon="inline-start" />
      {t('env.new')}
    </Button>
  )
  const saved = environments.find((item) => item.id === savedId)
  const hiddenSaved = saved && !table.getRowModel().rows.some((row) => row.id === savedId)
  const proxyOptions = [
    { value: 'direct', label: t('env.direct') },
    ...proxies.map((proxy) => ({ value: proxy.proxyId, label: `${proxy.host}:${proxy.port}` })),
  ]
  const kernelOptions = kernels.map((kernel) => ({ value: kernel.id, label: kernel.label }))
  for (const environment of environments) {
    if (!kernelOptions.some((item) => item.value === environment.kernelId))
      kernelOptions.push({ value: environment.kernelId, label: environment.kernelId })
    if (environment.proxyId && !proxyOptions.some((item) => item.value === environment.proxyId))
      proxyOptions.push({ value: environment.proxyId, label: environment.proxyId })
  }
  return (
    <>
      <h1 className="sr-only">{t('env.list')}</h1>
      {hiddenSaved && (
        <Alert>
          <AlertDescription>
            {t('env.hiddenResult')}
            <Button
              size="sm"
              variant="link"
              onClick={() => {
                table.setColumnFilters([])
                table.setGlobalFilter(saved.id)
                table.setPageIndex(0)
                setSavedId(undefined)
              }}
            >
              {t('env.showResult')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <BatchResult failures={batch.failures} />
      <DataTable
        table={table}
        label={t('env.list')}
        searchPlaceholder={t('env.search')}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        selectedRowId={savedId}
        actions={newAction}
        bulkActions={
          <DataTableBulkActions table={table} disabled={batch.pending}>
            {(['start', 'stop', 'delete'] as const).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === 'delete' ? 'destructive' : 'outline'}
                disabled={batch.pending || !eligible[action].length}
                onClick={() => setTarget({ action, items: eligible[action] })}
              >
                {t(action === 'delete' ? 'admin.delete' : `env.${action}`)} (
                {eligible[action].length})
              </Button>
            ))}
          </DataTableBulkActions>
        }
        filters={
          <>
            <DataTableFilter
              column={table.getColumn('status')}
              label={t('env.status')}
              options={environmentStatusSchema.options.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              }))}
              onFilterChange={() => table.setPageIndex(0)}
            />
            <DataTableFilter
              column={table.getColumn('kernelId')}
              label={t('env.kernel')}
              options={kernelOptions}
              onFilterChange={() => table.setPageIndex(0)}
            />
            <DataTableFilter
              column={table.getColumn('proxyId')}
              label={t('env.proxy')}
              options={proxyOptions}
              onFilterChange={() => table.setPageIndex(0)}
            />
          </>
        }
        emptyTitle={t(filtered ? 'env.noResults' : 'env.empty')}
        emptyDescription={t(filtered ? 'env.noResultsDescription' : 'env.emptyDescription')}
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={reset}>
              {t('table.reset')}
            </Button>
          ) : (
            newAction
          )
        }
        countLabel={(count) => t('env.total').replace('{count}', String(count))}
      />
      <ConfirmActionDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined)
        }}
        title={t('admin.confirmCount')
          .replace(
            '{action}',
            t(
              target?.action === 'delete'
                ? 'admin.delete'
                : target?.action === 'stop'
                  ? 'env.stop'
                  : 'env.start',
            ),
          )
          .replace('{count}', String(target?.items.length ?? 0))}
        description={t(
          target?.action === 'delete' ? 'env.deleteDescription' : 'env.batchDescription',
        )}
        actionLabel={t(target?.action === 'delete' ? 'admin.delete' : 'common.confirm')}
        destructive={target?.action === 'delete'}
        pending={batch.pending}
        onConfirm={() => void confirmBatch()}
      >
        <ul className="max-h-32 overflow-auto text-sm text-muted-foreground">
          {target?.items.map((item) => (
            <li key={item.id} className="truncate">
              {item.name}
            </li>
          ))}
        </ul>
        {batch.pending && (
          <p role="status" className="text-sm">
            {batch.progress.completed} / {batch.progress.total}
          </p>
        )}
      </ConfirmActionDialog>
      <EnvironmentConfirmDialog
        kind="stop"
        open={!!actions.stopTarget}
        onOpenChange={(open) => {
          if (!open) actions.setStopTarget(undefined)
        }}
        pending={!!actions.stopTarget && pending.has(actions.stopTarget.id)}
        onConfirm={actions.stop}
      />
    </>
  )
}
