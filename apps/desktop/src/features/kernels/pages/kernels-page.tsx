import { BULK_DELETE_LIMIT } from '@contextweave/contracts'
import { selectionColumn } from '@/components/data-table/data-table-selection'
import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import { BulkDeleteDialog } from '@/components/data-table/bulk-delete-dialog'
import { KernelRenameDialog } from '../components/kernel-rename-dialog'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
import { Spinner } from '@/components/ui/spinner'
import { useMemo, useState } from 'react'
import { DownloadIcon, InfoIcon, Trash2Icon, PencilIcon, ShieldCheckIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import type { KernelSummary } from '@/shared/types/app'
import { DataTableRowActions } from '@/components/data-table/data-table-row-actions'
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
import { KernelInstallDialog } from '../components/kernel-install-dialog'
import { KernelCapabilities } from '../components/kernel-capabilities'
import { useKernelVerification } from '../hooks/use-kernel-verification'
import { useKernelRemoval } from '../hooks/use-kernel-removal'
import { KernelRemoveDialog } from '../components/kernel-remove-dialog'
const getRowId = (row: KernelSummary) => row.id

export function KernelsPage() {
  const { t } = useI18n()
  const removal = useKernelRemoval()
  const { kernels, loading, kernelError, refresh } = useAppData(['kernels'])
  const api = useWorkspaceApi()
  const [detailId, setDetailId] = useState<string>()
  const detail = kernels.find((item) => item.id === detailId)
  const [renaming, setRenaming] = useState<KernelSummary>()
  const [bulk, setBulk] = useState<KernelSummary[]>()
  const { checking, verify } = useKernelVerification()
  const [installOpen, setInstallOpen] = useState(false)
  const statusLabels = useMemo(
    () => ({
      available: t('kernel.available'),
      'removal-pending': t('kernel.removalPending'),
      'not-installed': t('kernel.notInstalled'),
      'not-configured': t('kernel.notConfigured'),
      unsupported: t('kernel.platformUnsupported'),
    }),
    [t],
  )
  const columns = useMemo<ColumnDef<DataTableFeatures, KernelSummary, unknown>[]>(
    () => [
      selectionColumn<KernelSummary>(t),
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
          <Badge
            variant={
              row.original.status === 'available'
                ? 'success'
                : row.original.status === 'unsupported'
                  ? 'warning'
                  : 'secondary'
            }
          >
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
        header: t('env.actions'),
        meta: { label: t('env.actions'), align: 'end' },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <DataTableRowActions
            label={`${t('env.actions')}: ${row.original.label}`}
            actions={[
              {
                id: 'details',
                label: t('admin.details'),
                icon: InfoIcon,
                onClick: () => setDetailId(row.original.id),
              },
              {
                id: 'rename',
                label: t('kernel.rename'),
                icon: PencilIcon,
                onClick: () => setRenaming(row.original),
              },
              ...(row.original.removable
                ? [
                    {
                      id: 'remove',
                      label: t('kernel.remove'),
                      icon: Trash2Icon,
                      destructive: true,
                      disabled: removal.pending,
                      onClick: () => removal.select(row.original),
                    },
                  ]
                : []),
            ]}
          />
        ),
      },
    ],
    [t, statusLabels, removal],
  )
  const table = useDataTable({
    data: kernels,
    columns,
    getRowId,
    stateKey: 'kernels',
    loading,
    enableRowSelection: (row) =>
      row.original.removable &&
      row.original.verification?.state !== 'running' &&
      !['downloading', 'verifying', 'extracting', 'testing'].includes(
        row.original.installation?.phase ?? '',
      ),
  })
  return (
    <>
      <h1 className="sr-only">{t('kernel.list')}</h1>
      <DataTable
        table={table}
        actions={
          <Button size="sm" onClick={() => setInstallOpen(true)}>
            <DownloadIcon />
            {t('kernel.install')}
          </Button>
        }
        bulkActions={
          <DataTableBulkActions
            table={table}
            actions={[
              {
                id: 'delete',
                label: t('table.confirmDelete'),
                icon: Trash2Icon,
                destructive: true,
                disabled:
                  !table.getFilteredSelectedRowModel().rows.length ||
                  table.getFilteredSelectedRowModel().rows.length > BULK_DELETE_LIMIT,
                disabledReason: t('table.deleteLimit').replace(
                  '{count}',
                  String(BULK_DELETE_LIMIT),
                ),
                onClick: () =>
                  setBulk(table.getFilteredSelectedRowModel().rows.map((row) => row.original)),
              },
            ]}
          />
        }
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
          if (!open) setDetailId(undefined)
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
              {detail.source && (
                <p className="break-words text-sm text-muted-foreground">
                  {t('kernel.source')}: {detail.source}
                  <br />
                  {detail.license}
                </p>
              )}
              {detail.unsupportedReason && (
                <Alert>
                  <AlertDescription>{t('kernel.platformHelp')}</AlertDescription>
                </Alert>
              )}
              {!detail.packageAvailable && detail.status !== 'available' && (
                <Alert>
                  <AlertDescription>{t('kernel.noPackage')}</AlertDescription>
                </Alert>
              )}
              <Separator />
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t('kernel.capabilities')}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    checking ||
                    detail.verification?.state === 'running' ||
                    detail.status !== 'available'
                  }
                  onClick={() => void verify(detail.id)}
                >
                  {checking || detail.verification?.state === 'running' ? (
                    <Spinner />
                  ) : (
                    <ShieldCheckIcon />
                  )}
                  {t(checking ? 'kernel.testing' : 'kernel.verify')}
                </Button>
              </div>
              {detail.verification?.state === 'failed' && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {errorMessage(detail.verification.errorCode ?? 'KERNEL_PROBE_FAILED')}
                  </AlertDescription>
                </Alert>
              )}
              <KernelCapabilities report={detail.capabilityReport} />
            </>
          )}
        </DialogContent>
      </Dialog>
      {renaming && (
        <KernelRenameDialog
          key={renaming.id}
          kernel={renaming}
          onClose={() => setRenaming(undefined)}
        />
      )}
      {bulk && (
        <BulkDeleteDialog
          items={bulk.map((item) => ({ id: item.id, label: item.label }))}
          description={t('kernel.bulkDeleteHelp').replace(
            '{count}',
            String(bulk.reduce((count, item) => count + item.referenceCount, 0)),
          )}
          onClose={() => setBulk(undefined)}
          onConfirm={async (ids) => {
            const result = await unwrapIpc(api.kernel.removeMany(ids))
            await refresh()
            return result
          }}
          onResult={(result) =>
            table.setRowSelection((previous) =>
              Object.fromEntries(
                Object.entries(previous).filter(
                  ([id]) => !result.some((item) => item.id === id && item.ok),
                ),
              ),
            )
          }
        />
      )}
      <KernelRemoveDialog removal={removal} />
      <KernelInstallDialog open={installOpen} onOpenChange={setInstallOpen} />
    </>
  )
}
