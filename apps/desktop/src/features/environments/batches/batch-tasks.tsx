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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
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
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4" aria-label={t('batch.tasks')}>
      <Alert>
        <AlertDescription>{t('batch.help')}</AlertDescription>
      </Alert>
      {query.error && (
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('batch.refresh')}
        </Button>
        {cursors.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => setCursors([null])}>
            {t('batch.latest')}
          </Button>
        )}
      </div>
      {query.isPending ? (
        <p role="status" className="flex items-center gap-2">
          <Spinner />
          {t('batch.loading')}
        </p>
      ) : query.data?.items.length ? (
        <div className="min-h-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('batch.createdAt')}</TableHead>
                <TableHead>{t('batch.action')}</TableHead>
                <TableHead>{t('batch.progress')}</TableHead>
                <TableHead>{t('batch.result')}</TableHead>
                <TableHead>{t('env.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    {new Date(task.createdAt).toLocaleString(locale)}
                    <span
                      className="block max-w-48 truncate text-xs text-muted-foreground"
                      title={task.id}
                    >
                      {task.id}
                    </span>
                  </TableCell>
                  <TableCell>{t(`batch.action.${task.action}`)}</TableCell>
                  <TableCell>
                    <TaskProgress task={task} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`batch.status.${task.status}`)}</Badge>
                    <p className="text-xs text-muted-foreground">
                      {t('batch.counts')
                        .replace('{success}', String(task.counts.succeeded))
                        .replace('{failed}', String(task.counts.failed))
                        .replace('{unknown}', String(task.counts.unknown))}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => onSelect(task.id)}>
                      {t('batch.details')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        !query.error && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('batch.empty')}</EmptyTitle>
              <EmptyDescription>{t('batch.emptyHelp')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      )}
      <nav aria-label={t('batch.pagination')} className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={cursors.length === 1 || query.isFetching}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          {t('batch.previous')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!query.data?.nextCursor || query.isFetching || Boolean(query.error)}
          onClick={() => {
            const next = query.data?.nextCursor
            if (next) setCursors((current) => [...current, next])
          }}
        >
          {t('batch.next')}
        </Button>
      </nav>
      {selectedId && (
        <BatchTaskDialog
          key={selectedId}
          id={selectedId}
          onClose={() => onSelect(undefined)}
          onCreated={onSelect}
        />
      )}
    </section>
  )
}
function BatchTaskDialog({
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
