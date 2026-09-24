import { useMemo, useState } from 'react'
import { DownloadIcon, InfoIcon } from 'lucide-react'
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
const getRowId = (row: KernelSummary) => row.id

export function KernelsPage() {
  const { t } = useI18n()
  const { kernels, loading, kernelError, refresh } = useAppData(['kernels'])
  const [detail, setDetail] = useState<KernelSummary>()
  const [installOpen, setInstallOpen] = useState(false)
  const statusLabels = useMemo(
    () => ({
      available: t('kernel.available'),
      'not-installed': t('kernel.notInstalled'),
      'not-configured': t('kernel.notConfigured'),
      unsupported: t('kernel.platformUnsupported'),
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
                onClick: () => setDetail(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [t, statusLabels],
  )
  const table = useDataTable({ data: kernels, columns, getRowId, stateKey: 'kernels', loading })
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
              <h2 className="text-sm font-medium">{t('kernel.capabilities')}</h2>
              <KernelCapabilities report={detail.capabilityReport} />
            </>
          )}
        </DialogContent>
      </Dialog>
      <KernelInstallDialog open={installOpen} onOpenChange={setInstallOpen} />
    </>
  )
}
