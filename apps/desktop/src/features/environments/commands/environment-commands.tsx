import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { EnvironmentCommandReceipt } from '@contextweave/contracts'
import type { ColumnDef } from '@tanstack/react-table'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { CursorDataTable } from '@/components/data-table/cursor-data-table'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PendingCommands } from './pending-commands'
import { EnvironmentRecoveryDialog } from './recovery-dialog'
import { errorMessage } from '@/shared/lib/error-message'
const getRowId = (item: EnvironmentCommandReceipt) => item.requestId

export function EnvironmentCommands({ showHelp = false }: { showHelp?: boolean }) {
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
  const columns: ColumnDef<DataTableFeatures, EnvironmentCommandReceipt, unknown>[] = [
    {
      accessorKey: 'requestId',
      header: t('commands.requestId'),
      meta: { label: t('commands.requestId') },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.requestId}</span>,
    },
    {
      accessorKey: 'kind',
      header: t('batch.action'),
      meta: { label: t('batch.action') },
      cell: ({ row }) => t(`life.op.${row.original.kind}`),
    },
    {
      accessorKey: 'environmentId',
      header: t('commands.target'),
      meta: { label: t('commands.target') },
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="link"
          render={
            <Link
              to="/environments/$environmentId/edit"
              params={{ environmentId: row.original.environmentId }}
            />
          }
        >
          {row.original.environmentId}
        </Button>
      ),
    },
    {
      accessorKey: 'status',
      header: t('env.status'),
      meta: { label: t('env.status') },
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge
            variant={
              ['unknown', 'failed'].includes(row.original.status) ? 'destructive' : 'outline'
            }
          >
            {t(`commands.${row.original.status}`)}
          </Badge>
          {row.original.errorCode && (
            <span className="max-w-72 text-wrap text-xs text-muted-foreground">
              {errorMessage(row.original.errorCode)}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('commands.created'),
      meta: { label: t('commands.created') },
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(locale),
    },
    {
      id: 'actions',
      header: t('env.actions'),
      meta: { label: t('env.actions') },
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) =>
        row.original.status === 'queued' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(pending)}
            onClick={() => void cancel(row.original.requestId)}
          >
            {t('commands.cancelQueued')}
          </Button>
        ) : row.original.status === 'unknown' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRecover(row.original.environmentId)}
          >
            {t('env.recover')}
          </Button>
        ) : (
          '—'
        ),
    },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {showHelp && (
        <p className="text-sm text-muted-foreground">
          {t('commands.help')} {t('commands.cancelHelp')}
        </p>
      )}
      <PendingCommands />
      <CursorDataTable
        data={query.data?.items ?? []}
        columns={columns}
        getRowId={getRowId}
        label={t('commands.title')}
        emptyTitle={t('commands.none')}
        loading={query.isPending}
        refreshing={query.isFetching}
        error={error ?? query.error?.message}
        refreshLabel={t('common.refresh')}
        onRefresh={() => {
          setError(undefined)
          void query.refetch()
        }}
        previous={{
          label: t('commands.previous'),
          disabled: !cursors.length,
          onClick: () => setCursors((value) => value.slice(0, -1)),
        }}
        next={{
          label: t('commands.next'),
          disabled: !query.data?.nextBeforeId || query.isError,
          onClick: () => {
            const next = query.data?.nextBeforeId
            if (next) setCursors((value) => [...value, next])
          },
        }}
      />
      {recover && (
        <EnvironmentRecoveryDialog environmentId={recover} onClose={() => setRecover(undefined)} />
      )}
    </div>
  )
}
