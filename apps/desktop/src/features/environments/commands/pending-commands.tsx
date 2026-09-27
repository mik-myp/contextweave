import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { isEnvironmentCommandActive } from '@contextweave/contracts'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { errorMessage } from '@/shared/lib/error-message'
import { useCommandTracking } from './use-commands'
import type { PendingEnvironmentCommand } from './command-client'
import { EnvironmentRecoveryDialog } from './recovery-dialog'

function PendingCommand({ entry }: { entry: Readonly<PendingEnvironmentCommand> }) {
  const { context, commands } = useWorkspaceSession(),
    { t } = useI18n(),
    cache = useQueryClient()
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [recover, setRecover] = useState<string>()
  const query = useQuery({
    queryKey: workspaceKey(context, 'commands', 'tracked', entry.requestId),
    queryFn: () => commands.check(entry.requestId),
    retry: false,
    staleTime: 0,
    refetchInterval: (value) =>
      value.state.data?.state === 'found' &&
      isEnvironmentCommandActive(value.state.data.receipt.status)
        ? 2000
        : false,
  })
  const observation = query.data,
    receipt = observation?.state === 'found' ? observation.receipt : undefined
  const acknowledge = async () => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await commands.check(entry.requestId)
      commands.acknowledge(entry.requestId)
      await cache.invalidateQueries({ queryKey: workspaceKey(context) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorMessage('COMMAND_UNCONFIRMED'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Alert>
        <AlertTitle>
          {t(`life.op.${entry.kind}`)} ·{' '}
          {receipt ? t(`commands.${receipt.status}`) : t('commands.pendingTitle')}
        </AlertTitle>
        <AlertDescription>
          <p className="break-all font-mono">{entry.requestId}</p>
          <p>
            {observation?.state === 'not-found'
              ? t('commands.notFound')
              : t('commands.pendingHelp')}
          </p>
          {receipt?.errorCode && <p>{errorMessage(receipt.errorCode)}</p>}
          {query.error && <p role="alert">{query.error.message}</p>}
        </AlertDescription>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetching || busy}
            onClick={() => void query.refetch()}
          >
            {t('commands.check')}
          </Button>
          {receipt && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/environments/$environmentId/edit"
                  params={{ environmentId: receipt.environmentId }}
                />
              }
            >
              {t('env.view')}
            </Button>
          )}
          {receipt?.status === 'unknown' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRecover(receipt.environmentId)}
            >
              {t('env.recover')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !observation ||
              query.isFetching ||
              busy ||
              Boolean(receipt && isEnvironmentCommandActive(receipt.status))
            }
            onClick={() => setConfirm(true)}
          >
            {t('commands.acknowledge')}
          </Button>
        </div>
      </Alert>
      {recover && (
        <EnvironmentRecoveryDialog environmentId={recover} onClose={() => setRecover(undefined)} />
      )}
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('commands.ackTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('commands.ackHelp')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Badge variant="outline">{entry.requestId}</Badge>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void acknowledge()}>
              {t('commands.acknowledge')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
export function PendingCommands({ environmentId }: { environmentId?: string | null }) {
  const tracking = useCommandTracking(),
    { t } = useI18n()
  const [reset, setReset] = useState(false),
    [error, setError] = useState<string>()
  const entries = tracking.entries.filter(
    (entry) => environmentId === undefined || entry.environmentId === environmentId,
  )
  if (!tracking.problem && !entries.length) return null
  return (
    <section className="flex flex-col gap-3" aria-label={t('commands.pendingTitle')}>
      {tracking.problem && (
        <Alert variant="destructive">
          <AlertTitle>{t('commands.trackingProblem')}</AlertTitle>
          <AlertDescription>{error ?? errorMessage(tracking.problem)}</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={() => setReset(true)}>
            {t('commands.resetTracking')}
          </Button>
        </Alert>
      )}
      {entries.map((entry) => (
        <PendingCommand key={entry.requestId} entry={entry} />
      ))}
      <AlertDialog open={reset} onOpenChange={setReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('commands.resetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('commands.ackHelp')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                try {
                  tracking.client.resetInvalidIndex()
                  setReset(false)
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : errorMessage('COMMAND_TRACKING_UNAVAILABLE'),
                  )
                  setReset(false)
                }
              }}
            >
              {t('commands.resetTracking')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
