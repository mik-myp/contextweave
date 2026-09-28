import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DataTablePaginationControls } from '@/components/data-table/data-table-pagination'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { PendingCommands } from './pending-commands'
import { EnvironmentRecoveryDialog } from './recovery-dialog'
import { errorMessage } from '@/shared/lib/error-message'

export function EnvironmentCommands() {
  const { context, api } = useWorkspaceSession(),
    { t, locale } = useI18n(),
    cache = useQueryClient()
  const [cursors, setCursors] = useState<string[]>([]),
    [pending, setPending] = useState<string>(),
    [error, setError] = useState<string>(),
    [recover, setRecover] = useState<string>()
  const query = useQuery({
    queryKey: workspaceKey(context, 'commands', 'page', cursors.at(-1) ?? null),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const data = await unwrapIpc(
        api.environment.commandPage({ beforeId: cursors.at(-1) ?? null, limit: 20 }),
      )
      signal.throwIfAborted()
      return data
    },
    refetchInterval: (value) =>
      value.state.data?.items.some((item) => ['queued', 'running'].includes(item.status))
        ? 1000
        : false,
  })
  const cancel = async (requestId: string) => {
    if (pending) return
    setPending(requestId)
    setError(undefined)
    try {
      await unwrapIpc(api.environment.cancelCommand(requestId))
      await cache.invalidateQueries({ queryKey: workspaceKey(context, 'commands') })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorMessage('COMMAND_UNCONFIRMED'))
    } finally {
      setPending(undefined)
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4" aria-label={t('commands.title')}>
      <Alert>
        <AlertDescription>
          {t('commands.help')} {t('commands.cancelHelp')}
        </AlertDescription>
      </Alert>
      <PendingCommands />
      {(error || query.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error ?? query.error?.message}</AlertDescription>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCursors([])
              void query.refetch()
            }}
          >
            {t('common.refresh')}
          </Button>
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton className="h-32" />
      ) : query.data?.items.length ? (
        <Table aria-label={t('commands.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('commands.requestId')}</TableHead>
              <TableHead>{t('env.actions')}</TableHead>
              <TableHead>{t('commands.target')}</TableHead>
              <TableHead>{t('env.status')}</TableHead>
              <TableHead>{t('commands.created')}</TableHead>
              <TableHead>{t('env.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((item) => (
              <TableRow key={item.requestId}>
                <TableCell className="font-mono text-xs">{item.requestId}</TableCell>
                <TableCell>{t(`life.op.${item.kind}`)}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="link"
                    render={
                      <Link
                        to="/environments/$environmentId/edit"
                        params={{ environmentId: item.environmentId }}
                      />
                    }
                  >
                    {item.environmentId}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge
                      variant={
                        item.status === 'unknown' || item.status === 'failed'
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {t(`commands.${item.status}`)}
                    </Badge>
                    {item.errorCode && (
                      <span className="max-w-72 text-wrap text-xs text-muted-foreground">
                        {errorMessage(item.errorCode)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{new Date(item.createdAt).toLocaleString(locale)}</TableCell>
                <TableCell>
                  {item.status === 'queued' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(pending)}
                      onClick={() => void cancel(item.requestId)}
                    >
                      {t('commands.cancelQueued')}
                    </Button>
                  ) : item.status === 'unknown' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRecover(item.environmentId)}
                    >
                      {t('env.recover')}
                    </Button>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        !query.error && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('commands.none')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )
      )}
      <DataTablePaginationControls
        disabled={query.isFetching}
        previous={{
          label: t('commands.previous'),
          disabled: !cursors.length,
          onClick: () => setCursors((value) => value.slice(0, -1)),
        }}
        next={{
          label: t('commands.next'),
          disabled: !query.data?.nextBeforeId,
          onClick: () => {
            const next = query.data?.nextBeforeId
            if (next) setCursors((value) => [...value, next])
          },
        }}
      />
      {recover && (
        <EnvironmentRecoveryDialog environmentId={recover} onClose={() => setRecover(undefined)} />
      )}
    </section>
  )
}
