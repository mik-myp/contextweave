import type { ColumnDef } from '@tanstack/react-table'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { CursorDataTable } from '@/components/data-table/cursor-data-table'
import { useState } from 'react'
import { isBatchActive, type BatchSummary } from '@contextweave/contracts'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Progress, ProgressLabel } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useBatchPage, useBatchTask, useBatchCommand } from './use-batches'
import { BatchPreviewDialog } from './batch-preview-dialog'
function TaskProgress({ task }: { task: BatchSummary }) {
  const { t } = useI18n(),
    completed = task.total - task.counts.queued - task.counts.running
  return (
    <Progress
      value={completed}
      max={task.total}
      aria-label={t('batch.progress')}
      className="min-w-32"
    >
      <ProgressLabel>
        {completed} / {task.total}
      </ProgressLabel>
    </Progress>
  )
}
const batchRowId = (task: BatchSummary) => task.id
export function BatchTasks({
  selectedId,
  onSelect,
}: {
  selectedId?: string
  onSelect: (id?: string) => void
}) {
  const { t, locale } = useI18n(),
    [cursors, setCursors] = useState<(string | null)[]>([null])
  const query = useBatchPage(cursors.at(-1) ?? null)
  const columns: ColumnDef<DataTableFeatures, BatchSummary, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: t('batch.createdAt'),
      meta: { label: t('batch.createdAt') },
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(locale),
    },
    {
      accessorKey: 'action',
      header: t('batch.action'),
      meta: { label: t('batch.action') },
      cell: ({ row }) => t(`batch.action.${row.original.action}`),
    },
    {
      id: 'progress',
      header: t('batch.progress'),
      meta: { label: t('batch.progress') },
      enableSorting: false,
      cell: ({ row }) => <TaskProgress task={row.original} />,
    },
    {
      accessorKey: 'status',
      header: t('batch.result'),
      meta: { label: t('batch.result') },
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge
            variant={
              row.original.counts.failed || row.original.counts.unknown
                ? 'destructive'
                : 'secondary'
            }
          >
            {t(`batch.status.${row.original.status}`)}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {t('batch.counts')
              .replace('{success}', String(row.original.counts.succeeded))
              .replace('{failed}', String(row.original.counts.failed))
              .replace('{unknown}', String(row.original.counts.unknown))}
          </p>
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('env.actions'),
      meta: { label: t('env.actions') },
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => onSelect(row.original.id)}>
          {t('batch.details')}
        </Button>
      ),
    },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <CursorDataTable
        data={query.data?.items ?? []}
        columns={columns}
        getRowId={batchRowId}
        label={t('batch.history')}
        emptyTitle={t('batch.empty')}
        loading={query.isPending}
        refreshing={query.isFetching}
        error={query.error?.message}
        refreshLabel={t('batch.refresh')}
        onRefresh={() => void query.refetch()}
        actions={
          cursors.length > 1 && (
            <Button variant="outline" size="sm" onClick={() => setCursors([null])}>
              {t('batch.latest')}
            </Button>
          )
        }
        previous={{
          label: t('batch.previous'),
          disabled: cursors.length === 1,
          onClick: () => setCursors((current) => current.slice(0, -1)),
        }}
        next={{
          label: t('batch.next'),
          disabled: !query.data?.nextCursor || query.isError,
          onClick: () => {
            const next = query.data?.nextCursor
            if (next) setCursors((current) => [...current, next])
          },
        }}
      />
      {selectedId && (
        <BatchTaskDialog
          key={selectedId}
          id={selectedId}
          onClose={() => onSelect(undefined)}
          onCreated={onSelect}
        />
      )}
    </div>
  )
}
export function BatchTaskDialog({
  id,
  onClose,
  onCreated,
}: {
  id: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi(),
    query = useBatchTask(id),
    command = useBatchCommand(),
    [retry, setRetry] = useState(false)
  const task = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('batch.details')}</DialogTitle>
          <DialogDescription>{t('batch.cancelHelp')}</DialogDescription>
        </DialogHeader>
        {(query.error || command.error) && (
          <Alert variant="destructive">
            <AlertDescription>{query.error?.message || command.error}</AlertDescription>
          </Alert>
        )}
        {query.isPending && <p role="status">{t('batch.loading')}</p>}
        {task && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">{t(`batch.status.${task.status}`)}</Badge>
              <span>{t(`batch.action.${task.action}`)}</span>
              <TaskProgress task={task} />
            </div>
            {task.status === 'interrupted' && (
              <Alert>
                <AlertDescription>{t('batch.interruptedHelp')}</AlertDescription>
              </Alert>
            )}
            <div className="min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('env.name')}</TableHead>
                    <TableHead>{t('batch.revision')}</TableHead>
                    <TableHead>{t('batch.result')}</TableHead>
                    <TableHead>{t('batch.reason')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {task.items.map((item) => (
                    <TableRow key={item.environmentId}>
                      <TableCell>
                        <span className="block max-w-64 truncate" title={item.name}>
                          {item.name || '—'}
                        </span>
                        <span
                          className="block max-w-64 truncate text-xs text-muted-foreground"
                          title={item.environmentId}
                        >
                          {item.environmentId}
                        </span>
                      </TableCell>
                      <TableCell>{item.revision ?? '—'}</TableCell>
                      <TableCell>
                        {item.status === 'running' && task.action === 'start'
                          ? t('batch.starting')
                          : t(`batch.item.${item.status}`)}
                      </TableCell>
                      <TableCell>{item.reason ? errorMessage(item.reason) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('batch.close')}
          </Button>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('batch.refresh')}
          </Button>
          {task && isBatchActive(task.status) && (
            <Button
              variant="outline"
              disabled={command.pending || task.status === 'cancelling' || Boolean(query.error)}
              onClick={() => void command.run(() => api.batch.cancel(id))}
            >
              {command.pending && <Spinner data-icon="inline-start" />}
              {t('batch.cancel')}
            </Button>
          )}
          {task && !isBatchActive(task.status) && task.counts.failed > 0 && (
            <Button
              disabled={command.pending || Boolean(query.error)}
              onClick={() => setRetry(true)}
            >
              {t('batch.retryFailed')}
            </Button>
          )}
        </DialogFooter>
        {retry && (
          <BatchPreviewDialog
            request={{ retryTaskId: id }}
            onClose={() => setRetry(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
