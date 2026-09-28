import { useEffect, useRef, useState } from 'react'
import { isBatchActive } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { toast } from '@/components/ui/toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { BatchTaskDialog } from './batch-tasks'
import { useBatchPage } from './use-batches'

/** A task result belongs beside the user's action, not in a permanent management tab. */
export function BatchProgressNotice({
  selectedId,
  onSelect,
}: {
  selectedId?: string
  onSelect(id: string | undefined): void
}) {
  const { t } = useI18n()
  const query = useBatchPage(null)
  const [enteredAt] = useState(() => Date.now())
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const notified = useRef(new Set<string>())
  const observed = useRef(new Set<string>())
  useEffect(() => {
    for (const task of query.data?.items ?? []) {
      if (isBatchActive(task.status)) {
        observed.current.add(task.id)
        continue
      }
      if (notified.current.has(task.id)) continue
      if (!observed.current.has(task.id) && (!task.endedAt || Date.parse(task.endedAt) < enteredAt))
        continue
      notified.current.add(task.id)
      const hasProblems =
        task.counts.failed > 0 || task.counts.unknown > 0 || task.status === 'interrupted'
      // Adapted from @coss/p-toast-11: one notification ID per result, not per poll.
      toast.add({
        id: `batch-result-${task.id}`,
        type: hasProblems ? 'error' : task.status === 'cancelled' ? 'info' : 'success',
        title: `${t(`batch.action.${task.action}`)} · ${t(`batch.status.${task.status}`)}`,
        description: t('batch.counts')
          .replace('{success}', String(task.counts.succeeded))
          .replace('{failed}', String(task.counts.failed))
          .replace('{unknown}', String(task.counts.unknown)),
        timeout: hasProblems ? 0 : 5000,
        actionProps: { children: t('batch.viewResult'), onClick: () => onSelect(task.id) },
      })
    }
  }, [query.data, enteredAt, t, onSelect])
  useEffect(() => {
    const results = notified.current
    // These actions belong to this page's dialog; never leave a dead action after navigation.
    return () => {
      for (const id of results) toast.close(`batch-result-${id}`)
    }
  }, [])
  const visible =
    query.data?.items.filter(
      (task) =>
        isBatchActive(task.status) || (task.status === 'interrupted' && !dismissed.has(task.id)),
    ) ?? []
  return (
    <>
      {query.error && (
        <Alert variant="destructive">
          <AlertDescription>{t('batch.progressUnavailable')}</AlertDescription>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      )}
      {visible.map((task) => (
        <Alert key={task.id}>
          <AlertDescription>
            {t(`batch.action.${task.action}`)} · {t(`batch.status.${task.status}`)} ·{' '}
            {task.total - task.counts.queued - task.counts.running} / {task.total} ·{' '}
            {t('batch.counts')
              .replace('{success}', String(task.counts.succeeded))
              .replace('{failed}', String(task.counts.failed))
              .replace('{unknown}', String(task.counts.unknown))}
          </AlertDescription>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onSelect(task.id)}>
              {t(isBatchActive(task.status) ? 'batch.viewProgress' : 'batch.viewResult')}
            </Button>
            {!isBatchActive(task.status) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed((current) => new Set([...current, task.id]))}
              >
                {t('common.close')}
              </Button>
            )}
          </div>
        </Alert>
      ))}
      {selectedId && (
        <BatchTaskDialog
          key={selectedId}
          id={selectedId}
          onClose={() => onSelect(undefined)}
          onCreated={onSelect}
        />
      )}
    </>
  )
}
