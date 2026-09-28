import { useId } from 'react'
import { historyCleanupRetentionDaysSchema } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { useHistoryCleanup } from '../hooks/use-history-cleanup'

export function HistoryCleanup() {
  const { t, locale } = useI18n()
  const state = useHistoryCleanup()
  const label = useId()
  const busy = state.phase !== 'idle'
  const preview = state.preview
  const nonempty = preview && preview.sessions.count + preview.operations.count > 0
  const date = (value: string) => new Date(value).toLocaleString(locale, { timeZoneName: 'short' })
  const batch = preview
    ? t('cleanup.batch')
        .replace('{sessions}', String(preview.sessions.count))
        .replace('{operations}', String(preview.operations.count))
    : ''
  const saved = state.receipt.data
  return (
    <section className="flex flex-col gap-3" aria-label={t('cleanup.title')} aria-busy={busy}>
      <h3 className="font-medium">{t('cleanup.title')}</h3>
      <p className="text-sm text-muted-foreground">{t('cleanup.help')}</p>
      <p className="text-sm text-muted-foreground">{t('cleanup.protected')}</p>
      <FieldGroup>
        <Field>
          <FieldLabel id={label}>{t('cleanup.retention')}</FieldLabel>
          <ToggleGroup
            variant="outline"
            size="sm"
            aria-labelledby={label}
            value={[String(state.retentionDays)]}
            disabled={busy || Boolean(state.uncertainId)}
            onValueChange={(values) => {
              const parsed = historyCleanupRetentionDaysSchema.safeParse(Number(values[0]))
              if (parsed.success) state.setRetentionDays(parsed.data)
            }}
          >
            {[30, 90, 180, 365].map((days) => (
              <ToggleGroupItem key={days} value={String(days)}>
                {t('cleanup.days').replace('{days}', String(days))}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={busy || Boolean(state.uncertainId)}
          onClick={() => void state.loadPreview()}
        >
          {state.phase === 'previewing' && <Spinner data-icon="inline-start" />}
          {t('cleanup.preview')}
        </Button>
        {(preview || state.phase === 'previewing') && (
          <Button
            variant="ghost"
            disabled={busy && state.phase !== 'previewing'}
            onClick={state.discard}
          >
            {t('cleanup.discard')}
          </Button>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {state.uncertainId && (
          <Alert>
            <AlertDescription>{t('cleanup.uncertain')}</AlertDescription>
          </Alert>
        )}
        {preview && (
          <>
            <p className="text-sm">
              {t('cleanup.cutoff').replace('{date}', date(preview.cutoffAt))}
            </p>
            <p className="text-sm">
              {t('cleanup.expires').replace('{date}', date(preview.expiresAt))}
            </p>
            {nonempty ? (
              <>
                <p className="text-sm font-medium">{batch}</p>
                {(preview.sessions.hasMore || preview.operations.hasMore) && (
                  <p className="text-sm text-muted-foreground">{t('cleanup.more')}</p>
                )}
                <div>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => state.setDialogOpen(true)}
                  >
                    {t('cleanup.review')}
                  </Button>
                </div>
              </>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('cleanup.empty')}</EmptyTitle>
                  <EmptyDescription>{t('cleanup.emptyHelp')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )}
        {state.result && (
          <Alert>
            <AlertDescription>
              {t(state.result.replayed ? 'cleanup.replayed' : 'cleanup.committed')}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('cleanup.limit')}</p>
      <div className="flex flex-col gap-2" aria-label={t('cleanup.receipt')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{t('cleanup.receipt')}</h4>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void state.reconcile()}
          >
            {state.phase === 'reconciling' && <Spinner data-icon="inline-start" />}
            {t('cleanup.checkReceipt')}
          </Button>
        </div>
        {state.receipt.isPending ? (
          <Skeleton className="h-12" />
        ) : state.receipt.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.receipt.error.message}</AlertDescription>
          </Alert>
        ) : saved ? (
          <dl className="flex flex-col gap-1 text-sm">
            <div>
              <dt className="inline">{t('cleanup.completedAt')}: </dt>
              <dd className="inline">{date(saved.completedAt)}</dd>
            </div>
            {(['sessions', 'operations'] as const).map((kind) => (
              <div key={kind}>
                <dt className="inline">
                  {t(kind === 'sessions' ? 'cleanup.sessions' : 'cleanup.operations')}:{' '}
                </dt>
                <dd className="inline">
                  {t('cleanup.outcome')
                    .replace('{selected}', String(saved[kind].selected))
                    .replace('{deleted}', String(saved[kind].deleted))
                    .replace('{skipped}', String(saved[kind].skipped))}
                </dd>
              </div>
            ))}
            <div>
              <dt className="sr-only">{t('cleanup.details')}</dt>
              <dd>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    {t('cleanup.details')}
                  </summary>
                  <dl className="mt-2 flex flex-col gap-1">
                    <div>
                      <dt className="inline">{t('cleanup.batchId')}: </dt>
                      <dd className="inline break-all font-mono text-xs">{saved.previewId}</dd>
                    </div>
                    <div>
                      <dt className="inline">{t('cleanup.cutoffLabel')}: </dt>
                      <dd className="inline">{date(saved.cutoffAt)}</dd>
                    </div>
                  </dl>
                </details>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t('cleanup.noReceipt')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('cleanup.receiptHelp')}</p>
      </div>
      <AlertDialog open={state.dialogOpen} onOpenChange={state.setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cleanup.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {batch} {t('cleanup.confirmHelp')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void state.confirm()}
            >
              {state.phase === 'confirming' && <Spinner data-icon="inline-start" />}
              {t('cleanup.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
