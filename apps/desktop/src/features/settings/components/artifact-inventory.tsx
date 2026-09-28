import { useI18n } from '@/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DataTablePaginationControls } from '@/components/data-table/data-table-pagination'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table'
import { useArtifactInventory } from '../hooks/use-artifact-inventory'

export function ArtifactInventory() {
  const { t, locale } = useI18n()
  const { query, cursor, setCursor } = useArtifactInventory()
  const page = !query.error ? query.data : undefined
  const number = (value: number) => new Intl.NumberFormat(locale).format(value)
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('artifacts.title')}
      aria-busy={query.isFetching}
    >
      <h3 className="font-medium">{t('artifacts.title')}</h3>
      <p className="text-sm text-muted-foreground">{t('artifacts.help')}</p>
      <p className="text-sm text-muted-foreground">{t('artifacts.limitations')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('common.refresh')}
        </Button>
        {cursor && (
          <Button variant="ghost" onClick={() => setCursor(null)}>
            {t('history.latest')}
          </Button>
        )}
      </div>
      {query.isPending ? (
        <Skeleton className="h-24" />
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : (
        page && (
          <>
            <p className="text-sm font-medium" role="status">
              {t('artifacts.total')
                .replace('{count}', number(page.totals.count))
                .replace('{bytes}', number(page.totals.bytes))}
            </p>
            {page.items.length ? (
              <Table>
                <TableCaption>{t('artifacts.recorded')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('artifacts.completedAt')}</TableHead>
                    <TableHead>{t('artifacts.environment')}</TableHead>
                    <TableHead>{t('artifacts.identity')}</TableHead>
                    <TableHead>{t('artifacts.bytes')}</TableHead>
                    <TableHead>SHA-256</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((item) => (
                    <TableRow key={item.artifactId}>
                      <TableCell>{new Date(item.completedAt).toLocaleString(locale)}</TableCell>
                      <TableCell>
                        <div className="max-w-40 break-words whitespace-normal">
                          {item.environmentName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          className="max-w-64 break-all whitespace-normal font-mono text-xs"
                          dir="ltr"
                        >
                          {item.artifactId}
                          <br />
                          {item.taskId}
                        </div>
                      </TableCell>
                      <TableCell>{number(item.bytes)} B</TableCell>
                      <TableCell>
                        <div
                          className="max-w-48 break-all whitespace-normal font-mono text-xs"
                          dir="ltr"
                        >
                          {item.sha256}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('artifacts.empty')}</EmptyTitle>
                  <EmptyDescription>{t('artifacts.emptyHelp')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            <DataTablePaginationControls
              label={t('artifacts.pagination')}
              disabled={query.isFetching}
              previous={{
                label: t('artifacts.previous'),
                disabled: !page.previousCursor,
                onClick: () => setCursor(page.previousCursor),
              }}
              next={{
                label: t('artifacts.next'),
                disabled: !page.nextCursor,
                onClick: () => setCursor(page.nextCursor),
              }}
            />
          </>
        )
      )}
    </section>
  )
}
