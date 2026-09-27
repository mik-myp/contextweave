import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

export function EnvironmentRecoveryDialog({
  environmentId,
  onClose,
  onRecovered,
}: {
  environmentId: string
  onClose(): void
  onRecovered?(): void
}) {
  const { context, api, commands } = useWorkspaceSession(),
    cache = useQueryClient(),
    { t } = useI18n()
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>()
  const inspection = useQuery({
    queryKey: workspaceKey(context, 'commands', 'recovery', environmentId),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const data = await unwrapIpc(api.environment.inspectRecovery(environmentId))
      signal.throwIfAborted()
      return data
    },
    staleTime: 0,
    retry: false,
  })
  const confirm = async () => {
    if (pending || !inspection.data?.canRecover) return
    setPending(true)
    setError(undefined)
    try {
      await commands.execute({
        kind: 'recover',
        environmentId,
        expectedRevision: inspection.data.revision,
      })
      await cache.invalidateQueries({ queryKey: workspaceKey(context) })
      onRecovered?.()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorMessage('COMMAND_UNCONFIRMED'))
    } finally {
      setPending(false)
    }
  }
  const value = inspection.data
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('commands.recoveryTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('commands.recoveryHelp')}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-all font-mono text-sm">{environmentId}</p>
        {inspection.isPending ? (
          <Skeleton className="h-16" />
        ) : (
          value && (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {t('life.revision')}: {value.revision}
              </p>
              <p>
                {t('commands.lock')}: {t(`commands.lock.${value.lockState}`)}
              </p>
              <p>
                {t('commands.sessions')
                  .replace('{live}', String(value.possiblyLiveSessions))
                  .replace('{total}', String(value.recordedActiveSessions))}
              </p>
              {value.hasUnconfirmedCommand && <p>{t('commands.unconfirmed')}</p>}
              {value.reason && (
                <Alert>
                  <AlertDescription>{errorMessage(value.reason)}</AlertDescription>
                </Alert>
              )}
            </div>
          )
        )}
        {(error || inspection.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error ?? inspection.error?.message}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={pending || inspection.isFetching}
            onClick={() => void inspection.refetch()}
          >
            {t('commands.check')}
          </Button>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || inspection.isFetching || !value?.canRecover}
            onClick={() => void confirm()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {t('commands.recoveryConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
