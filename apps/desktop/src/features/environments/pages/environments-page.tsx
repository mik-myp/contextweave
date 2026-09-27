import { BatchPreviewDialog } from '../batches/batch-preview-dialog'
import { BatchTasks } from '../batches/batch-tasks'
import type { BatchAction } from '@contextweave/contracts'
import {
  organizeEnvironments,
  useOrganization,
  type OrganizedEnvironment,
} from '../organization/use-organization'
import { EnvironmentOrganizationDialog } from '../organization/environment-organization-dialog'
import { GroupManagerDialog } from '../organization/group-manager-dialog'
import { SavedViewsDialog } from '../organization/saved-views-dialog'
import { organizationNameKey } from '@contextweave/contracts'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { EnvironmentTrash } from '../components/environment-trash'
import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import { useMemo, useState, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { PlayIcon, PlusIcon, SquareIcon, Trash2Icon } from 'lucide-react'
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
  const { t } = useI18n()
  const [tab, setTab] = useState('active'),
    [selectedTask, setSelectedTask] = useState<string>()
  const onCreated = useCallback((id: string) => {
    setSelectedTask(id)
    setTab('batches')
  }, [])
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(String(value))}
      className="min-h-0 flex-1 gap-4"
    >
      <TabsList className="shrink-0">
        <TabsTrigger value="active">{t('life.active')}</TabsTrigger>
        <TabsTrigger value="trash">{t('life.trash')}</TabsTrigger>
        <TabsTrigger value="batches">{t('batch.tasks')}</TabsTrigger>
      </TabsList>
      <TabsContent value="active" className="flex min-h-0 flex-col gap-4">
        <ActiveEnvironmentsPage onCreated={onCreated} />
      </TabsContent>
      <TabsContent value="trash" className="flex min-h-0 flex-col gap-4">
        <EnvironmentTrash onCreated={onCreated} />
      </TabsContent>
      <TabsContent value="batches" className="flex min-h-0 flex-col gap-4">
        <BatchTasks selectedId={selectedTask} onSelect={setSelectedTask} />
      </TabsContent>
    </Tabs>
  )
}
function ActiveEnvironmentsPage({ onCreated }: { onCreated: (id: string) => void }) {
  const { t, locale } = useI18n()
  const { environments, kernels, proxies, loading, error, refresh } = useAppData([
    'environments',
    'kernels',
    'proxies',
  ])
  const organization = useOrganization()
  const rows = useMemo(
    () => organizeEnvironments(environments, organization.data),
    [environments, organization.data],
  )
  const [organizationTarget, setOrganizationTarget] = useState<OrganizedEnvironment>()
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const actions = useEnvironmentActions()
  const [target, setTarget] = useState<{
    action: BatchAction
    items: EnvironmentSummary[]
  }>()
  const onDelete = useCallback(
    (item: EnvironmentSummary) => setTarget({ action: 'trash', items: [item] }),
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
        onOrganize: setOrganizationTarget,
      }),
    [t, locale, kernels, proxies, pending, start, setStopTarget, onDelete],
  )
  const table = useDataTable({
    data: rows,
    columns,
    getRowId,
    stateKey: 'environments',
    enableRowSelection: true,
    loading,
    initialState: { sorting: [{ id: 'updatedAt', desc: true }], columnVisibility: { note: false } },
  })
  const selected = table.getFilteredSelectedRowModel().rows.map((row) => row.original)
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
      {organizationTarget && (
        <EnvironmentOrganizationDialog
          environment={organizationTarget}
          onClose={() => setOrganizationTarget(undefined)}
        />
      )}
      {groupsOpen && <GroupManagerDialog onClose={() => setGroupsOpen(false)} />}
      {viewsOpen && <SavedViewsDialog table={table} onClose={() => setViewsOpen(false)} />}
      <DataTable
        table={table}
        label={t('env.list')}
        searchPlaceholder={t('org.search')}
        searchMaxLength={200}
        loading={loading || organization.isPending}
        error={error ?? organization.error?.message}
        onRetry={() => {
          void refresh()
          void organization.refetch()
        }}
        selectedRowId={savedId}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!organization.data || organization.isError}
              onClick={() => setGroupsOpen(true)}
            >
              {t('org.groups')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!organization.data || organization.isError}
              onClick={() => setViewsOpen(true)}
            >
              {t('org.views')}
            </Button>
            {newAction}
          </>
        }
        bulkActions={
          <DataTableBulkActions
            table={table}
            actions={(['start', 'stop', 'trash'] as const).map((action) => ({
              id: action,
              label: `${t(`batch.action.${action}`)} (${selected.length})`,
              icon: { start: PlayIcon, stop: SquareIcon, trash: Trash2Icon }[action],
              destructive: action === 'trash',
              disabled: !selected.length,
              onClick: () => setTarget({ action, items: selected }),
            }))}
          />
        }
        filters={
          <>
            <DataTableFilter
              column={table.getColumn('groupId')}
              label={t('org.group')}
              options={[
                { value: 'ungrouped', label: t('org.ungrouped') },
                ...(organization.data?.groups ?? []).map((group) => ({
                  value: group.id,
                  label: group.name,
                })),
              ]}
              onFilterChange={() => table.setPageIndex(0)}
            />
            <DataTableFilter
              column={table.getColumn('tags')}
              label={t('org.tags')}
              options={[
                ...new Map(
                  rows.flatMap((row) => row.tags).map((tag) => [organizationNameKey(tag), tag]),
                ).entries(),
              ].map(([value, label]) => ({ value, label }))}
              onFilterChange={() => table.setPageIndex(0)}
              showCounts={false}
            />

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
      {target && (
        <BatchPreviewDialog
          request={{ action: target.action, environmentIds: target.items.map((item) => item.id) }}
          onClose={() => setTarget(undefined)}
          onCreated={(id) => {
            table.resetRowSelection()
            onCreated(id)
          }}
        />
      )}
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
