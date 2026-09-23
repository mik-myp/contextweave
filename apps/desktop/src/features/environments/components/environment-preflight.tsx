import { useQuery } from '@tanstack/react-query'
import type { EnvironmentDetails } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { FormSection } from '@/components/form-section'
export function EnvironmentPreflight({ detail }: { detail?: EnvironmentDetails }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['local', 'environments', 'preflight', detail?.id, detail?.revision],
    queryFn: () => unwrapIpc(window.contextweave.environment.preflight(detail!.id)),
    enabled: !!detail,
    staleTime: 10_000,
    retry: false,
  })
  return (
    <FormSection
      title={t('life.preflight')}
      description={t(detail ? 'life.preflightSaved' : 'life.preflightNew')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {t(
            detail && detail.kernelId !== 'standard-chromium'
              ? 'life.cap.unverified'
              : 'life.native',
          )}
        </Badge>
        {detail && (
          <Badge variant="outline">
            {t('life.revision')} {detail.revision ?? 1}
          </Badge>
        )}
        {detail && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('life.preflightCheck')}
          </Button>
        )}
      </div>
      {detail && query.isPending && <Skeleton className="h-24" />}
      {query.error && (
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.data && (
        <Alert variant={query.data.canStart ? 'default' : 'destructive'}>
          <AlertTitle>
            {t(query.data.canStart ? 'life.preflightReady' : 'life.preflightBlocked')}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-2 ps-4">
              {query.data.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{errorMessage(issue.code)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </FormSection>
  )
}
