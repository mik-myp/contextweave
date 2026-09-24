import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/i18n'
import { useCredentialCleanup } from '../use-credential-cleanup'
export function CredentialCleanupNotice() {
  const { t } = useI18n()
  const { status, retry } = useCredentialCleanup()
  const failed = status.isError || retry.isError
  if (!failed && !status.data?.pendingCount && !status.data?.temporaryFilesPending) return null
  return (
    <Alert>
      <AlertTitle>{t('proxy.cleanup.title')}</AlertTitle>
      <AlertDescription>
        {failed ? (
          <p>{t('proxy.cleanup.failed')}</p>
        ) : status.data?.pendingCount ? (
          <p>
            {t('proxy.cleanup.description').replace('{count}', String(status.data.pendingCount))}
          </p>
        ) : null}
        {status.data?.temporaryFilesPending && <p>{t('proxy.cleanup.temporary')}</p>}
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending || status.isFetching}
          onClick={() => retry.mutate()}
        >
          {retry.isPending && <Spinner data-icon="inline-start" />}
          {t('proxy.cleanup.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
