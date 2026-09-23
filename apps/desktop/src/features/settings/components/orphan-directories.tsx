import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
export function OrphanDirectories() {
  const { t, locale } = useI18n()
  const query = useQuery({
    queryKey: ['local', 'storage', 'orphans'],
    queryFn: () => unwrapIpc(window.contextweave.storage.orphans()),
  })
  return (
    <section className="flex flex-col gap-3" aria-label={t('life.orphans')}>
      <h3 className="font-medium">{t('life.orphans')}</h3>
      <p className="text-sm text-muted-foreground">{t('life.orphansHelp')}</p>
      {query.isPending ? (
        <Skeleton className="h-16" />
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : query.data?.length ? (
        <dl className="flex flex-col gap-2">
          {query.data.map((entry) => (
            <div key={entry.name} className="flex flex-wrap justify-between gap-2 text-sm">
              <dt className="break-all font-mono">{entry.name}</dt>
              <dd className="text-muted-foreground">
                {new Date(entry.modifiedAt).toLocaleString(locale)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t('life.orphansEmpty')}</p>
      )}
    </section>
  )
}
