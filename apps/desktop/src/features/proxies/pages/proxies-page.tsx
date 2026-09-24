import { useCallback, useMemo, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { proxyTypeSchema } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import type { ProxySummary } from '@/shared/types/app'
import { unwrapIpc } from '@/shared/lib/ipc'
import { useBatchMutation } from '@/shared/hooks/use-batch-mutation'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableFilter } from '@/components/data-table/data-table-filter'
import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import { useDataTable } from '@/components/data-table/use-data-table'
import { Button } from '@/components/ui/button'
import { BatchResult } from '@/components/batch-result'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { isEnvironmentReadOnly } from '@/features/environments/environment-service'
import { proxyColumns } from '../proxy-columns'
import { CredentialCleanupNotice } from '../components/credential-cleanup-notice'
import { ProxyDialog } from '../components/proxy-dialog'
import { ProxyImportDialog } from '../components/proxy-import-dialog'
const getRowId = (row: ProxySummary) => row.proxyId

export function ProxiesPage() {
  const { t, locale } = useI18n()
  const { proxies, environments, loading, proxyError, refresh, setNotice } = useAppData([
    'proxies',
    'environments',
  ])
  const [importing, setImporting] = useState(false)
  const [editor, setEditor] = useState<{ proxy?: ProxySummary }>()
  const [targets, setTargets] = useState<ProxySummary[]>([])
  const batch = useBatchMutation(['proxies', 'environments'])
  const { usage, locked } = useMemo(() => {
    const usage = new Map<string, number>()
    const locked = new Set<string>()
    for (const environment of environments)
      if (environment.proxyId) {
        usage.set(environment.proxyId, (usage.get(environment.proxyId) ?? 0) + 1)
        if (isEnvironmentReadOnly(environment.status)) locked.add(environment.proxyId)
      }
    return { usage, locked }
  }, [environments])
  const [testing, setTesting] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<
    Record<string, import('@contextweave/contracts').ProxyTestResult>
  >({})
  const testProxy = useCallback(
    async (proxy: ProxySummary) => {
      setTesting((value) => new Set(value).add(proxy.proxyId))
      try {
        const result = await unwrapIpc(window.contextweave.proxy.test({ proxyId: proxy.proxyId }))
        setResults((value) => ({ ...value, [`${proxy.proxyId}:${proxy.updatedAt}`]: result }))
      } catch (cause) {
        setNotice({
          kind: 'error',
          message: cause instanceof Error ? cause.message : t('admin.operationError'),
        })
      } finally {
        setTesting((value) => {
          const next = new Set(value)
          next.delete(proxy.proxyId)
          return next
        })
      }
    },
    [setNotice, t],
  )
  const columns = useMemo(
    () =>
      proxyColumns({
        t,
        locale,
        usage,
        locked,
        testing,
        results,
        onTest: (proxy) => void testProxy(proxy),
        onEdit: (proxy) => setEditor({ proxy }),
        onDelete: (proxy) => setTargets([proxy]),
      }),
    [t, locale, usage, locked, testing, results, testProxy],
  )
  const table = useDataTable({
    data: proxies,
    columns,
    getRowId,
    stateKey: 'proxies',
    enableRowSelection: true,
    loading,
    initialState: { sorting: [{ id: 'updatedAt', desc: true }] },
  })
  const selected = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original)
    .filter((row) => !usage.get(row.proxyId))
  const filtered = !!table.state.globalFilter || table.state.columnFilters.length > 0
  const add = (
    <Button size="sm" onClick={() => setEditor({})}>
      <PlusIcon data-icon="inline-start" />
      {t('proxy.new')}
    </Button>
  )
  const remove = async () => {
    const result = await batch.run({
      items: targets,
      getId: getRowId,
      getLabel: (row) => `${row.host}:${row.port}`,
      action: (row) => unwrapIpc(window.contextweave.proxy.delete(row.proxyId)),
    })
    if (result)
      table.setRowSelection((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !result.succeeded.includes(id)),
        ),
      )
    setTargets([])
  }
  return (
    <>
      <h1 className="sr-only">{t('proxy.list')}</h1>
      <CredentialCleanupNotice />
      <BatchResult failures={batch.failures} />
      <DataTable
        table={table}
        label={t('proxy.list')}
        searchPlaceholder={t('proxy.search')}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              {t('proxy.import.title')}
            </Button>
            {add}
          </>
        }
        loading={loading}
        error={proxyError}
        onRetry={() => void refresh()}
        filters={
          <>
            <DataTableFilter
              column={table.getColumn('type')}
              label={t('proxy.type')}
              options={proxyTypeSchema.options.map((value) => ({
                value,
                label: value.toUpperCase(),
              }))}
              onFilterChange={() => table.setPageIndex(0)}
            />
            <DataTableFilter
              column={table.getColumn('auth')}
              label={t('proxy.auth')}
              options={[
                { value: 'none', label: t('proxy.noAuth') },
                { value: 'username', label: t('proxy.usernameOnly') },
                { value: 'password', label: t('proxy.passwordSet') },
              ]}
              onFilterChange={() => table.setPageIndex(0)}
            />
          </>
        }
        emptyTitle={t(filtered ? 'env.noResults' : 'proxy.empty')}
        emptyDescription={t(filtered ? 'env.noResultsDescription' : 'proxy.emptyDescription')}
        emptyAction={
          filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                table.setGlobalFilter('')
                table.setColumnFilters([])
              }}
            >
              {t('table.reset')}
            </Button>
          ) : (
            add
          )
        }
        countLabel={(count) => t('proxy.total').replace('{count}', String(count))}
        bulkActions={
          <DataTableBulkActions
            table={table}
            disabled={batch.pending}
            actions={[
              {
                id: 'delete',
                label: `${t('admin.delete')} (${selected.length})`,
                icon: Trash2Icon,
                destructive: true,
                disabled: !selected.length,
                pending: batch.pending,
                onClick: () => setTargets(selected),
              },
            ]}
          />
        }
      />
      {importing && <ProxyImportDialog onClose={() => setImporting(false)} />}
      {editor && <ProxyDialog proxy={editor.proxy} onClose={() => setEditor(undefined)} />}
      <ConfirmActionDialog
        open={targets.length > 0}
        onOpenChange={(open) => {
          if (!open) setTargets([])
        }}
        title={t('admin.confirmCount')
          .replace('{action}', t('admin.delete'))
          .replace('{count}', String(targets.length))}
        description={t('proxy.deleteDescription')}
        actionLabel={t('admin.delete')}
        destructive
        pending={batch.pending}
        onConfirm={() => void remove()}
      >
        <ul className="max-h-32 overflow-auto text-sm text-muted-foreground">
          {targets.map((row) => (
            <li key={row.proxyId}>
              {row.host}:{row.port}
            </li>
          ))}
        </ul>
      </ConfirmActionDialog>
    </>
  )
}
