import { useMemo, useRef, useState } from 'react'
import { DownloadIcon, InfoIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import type { KernelSummary } from '@/shared/types/app'
import { unwrapIpc } from '@/shared/lib/ipc'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableFilter } from '@/components/data-table/data-table-filter'
import { useDataTable } from '@/components/data-table/use-data-table'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { KernelCapabilities } from '../components/kernel-capabilities'
const getRowId = (row: KernelSummary) => row.id

export function KernelsPage() {
  const { t } = useI18n()
  const { kernels, loading, kernelError, refresh, setNotice } = useAppData(['kernels'])
  const [detail, setDetail] = useState<KernelSummary>()
  const [target, setTarget] = useState<KernelSummary>()
  const [pending, setPending] = useState(false)
  const active = useRef(false)
  const statusLabels = useMemo(
    () => ({
      available: t('kernel.available'),
      'not-installed': t('kernel.notInstalled'),
      'not-configured': t('kernel.notConfigured'),
    }),
    [t],
  )
  const columns = useMemo<ColumnDef<DataTableFeatures, KernelSummary, unknown>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (row) => `${row.label} ${row.id}`,
        header: t('kernel.name'),
        meta: { label: t('kernel.name') },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-40 flex-col gap-0.5">
            <span className="font-medium">{row.original.label}</span>
            <span className="text-xs text-muted-foreground">{row.id}</span>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('kernel.status'),
        meta: { label: t('kernel.status') },
        filterFn: 'isOneOf',
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'available' ? 'success' : 'outline'}>
            {statusLabels[row.original.status as keyof typeof statusLabels] ?? row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: 'version',
        header: t('kernel.version'),
        meta: { label: t('kernel.version') },
        enableGlobalFilter: false,
        cell: ({ row }) =>
          row.original.version === 'local' ? t('kernel.local') : row.original.version,
      },
      {
        id: 'platform',
        accessorFn: (row) => `${row.platform} / ${row.arch}`,
        header: t('kernel.platform'),
        meta: { label: t('kernel.platform') },
        enableGlobalFilter: false,
      },
      {
        id: 'actions',
        header: '',
        meta: { label: t('env.actions'), align: 'end' },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDetail(row.original)}>
              <InfoIcon data-icon="inline-start" />
              {t('admin.details')}
            </Button>
            {row.original.status !== 'available' && row.original.packageAvailable && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setTarget(row.original)}
              >
                <DownloadIcon data-icon="inline-start" />
                {t('kernel.install')}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, statusLabels, pending],
  )
  const table = useDataTable({ data: kernels, columns, getRowId, stateKey: 'kernels', loading })
  const install = async () => {
    if (!target || active.current) return
    active.current = true
    setPending(true)
    try {
      await unwrapIpc(window.contextweave.kernel.install(target.id))
      await refresh()
      setNotice({ kind: 'success', message: t('kernel.installed') })
      setTarget(undefined)
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : t('admin.operationError'),
      })
      setTarget(undefined)
    } finally {
      active.current = false
      setPending(false)
    }
  }
  return (
    <>
      <h1 className="sr-only">{t('kernel.list')}</h1>
      <DataTable
        table={table}
        label={t('kernel.list')}
        searchPlaceholder={t('kernel.search')}
        loading={loading}
        error={kernelError}
        onRetry={() => void refresh()}
        emptyTitle={t('kernel.empty')}
        emptyDescription={t('kernel.emptyDescription')}
        filters={
          <DataTableFilter
            column={table.getColumn('status')}
            label={t('kernel.status')}
            options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
            onFilterChange={() => table.setPageIndex(0)}
          />
        }
      />
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(undefined)
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{detail?.label}</DialogTitle>
            <DialogDescription>
              {detail?.version === 'local' ? t('kernel.local') : detail?.version} ·{' '}
              {detail?.platform} / {detail?.arch}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">{t('kernel.path')}</h2>
                <p className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
                  {detail.executablePath ?? t('admin.unavailable')}
                </p>
              </div>
              {!detail.packageAvailable && detail.status !== 'available' && (
                <Alert>
                  <AlertDescription>{t('kernel.noPackage')}</AlertDescription>
                </Alert>
              )}
              <Separator />
              <h2 className="text-sm font-medium">{t('kernel.capabilities')}</h2>
              <KernelCapabilities report={detail.capabilityReport} />
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined)
        }}
        title={t('kernel.installTitle')}
        description={t('kernel.installDescription')}
        actionLabel={t('kernel.install')}
        pending={pending}
        onConfirm={() => void install()}
      >
        <p className="text-sm font-medium">{target?.label}</p>
        {pending && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t('kernel.installing')}
          </p>
        )}
      </ConfirmActionDialog>
    </>
  )
}
