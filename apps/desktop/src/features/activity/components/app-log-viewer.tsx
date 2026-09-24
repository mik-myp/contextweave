import { useMemo, useState } from 'react'
import type { AppLogEntry } from '@contextweave/contracts'
import { RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { useAppLogs } from '../hooks/use-app-logs'
import {
  defaultLogFilters,
  filterAppLogs,
  hasLogFilters,
  hasInvalidLogTimeRange,
  type LogFilters,
} from '../lib/log-filters'
import { describeLogEntry } from '../lib/log-labels'
import { AppLogToolbar } from './app-log-toolbar'
import { AppLogTable } from './app-log-table'
import { AppLogDetailDialog } from './app-log-detail-dialog'

export function AppLogViewer() {
  const { t } = useI18n()
  const [filters, setFilters] = useState<LogFilters>(defaultLogFilters)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [follow, setFollow] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)
  const [selected, setSelected] = useState<AppLogEntry>()
  const { query, clear } = useAppLogs(autoRefresh)
  const snapshot = query.data
  const entries = useMemo(
    () => filterAppLogs(snapshot?.entries ?? [], filters, (entry) => describeLogEntry(entry, t)),
    [snapshot, filters, t],
  )
  const methods = useMemo(
    () =>
      [
        ...new Set([
          ...(snapshot?.entries ?? [])
            .filter((entry) => filters.source === 'all' || entry.source === filters.source)
            .flatMap((entry) => (entry.method ? [entry.method] : [])),
          ...(filters.method === 'all' ? [] : [filters.method]),
        ]),
      ].sort(),
    [snapshot, filters.source, filters.method],
  )
  const error = clear.error?.message ?? query.error?.message
  const reset = () => setFilters(defaultLogFilters)
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4" aria-label={t('logs.application')}>
      <AppLogToolbar filters={filters} onChange={setFilters} methods={methods} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3">
        <Field orientation="horizontal" className="w-auto" title={t('logs.autoRefreshHelp')}>
          <Switch
            id="logs-auto-refresh"
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
            size="sm"
          />
          <FieldLabel htmlFor="logs-auto-refresh">{t('logs.autoRefresh')}</FieldLabel>
        </Field>
        <Field orientation="horizontal" className="w-auto" title={t('logs.followHelp')}>
          <Switch id="logs-follow" checked={follow} onCheckedChange={setFollow} size="sm" />
          <FieldLabel htmlFor="logs-follow">{t('logs.follow')}</FieldLabel>
        </Field>
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching || clear.isPending}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {t('common.refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!snapshot?.entries.length || clear.isPending}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            {t('logs.clear')}
          </Button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {hasInvalidLogTimeRange(filters) && (
        <Alert variant="destructive">
          <AlertDescription>{t('logs.invalidTime')}</AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <div
          role="status"
          className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner />
          {t('logs.loading')}
        </div>
      ) : (
        <AppLogTable
          entries={entries}
          filtered={hasLogFilters(filters)}
          follow={follow}
          onFollowChange={setFollow}
          onReset={reset}
          onSelect={setSelected}
        />
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          {t('logs.count')
            .replace('{filtered}', String(entries.length))
            .replace('{total}', String(snapshot?.entries.length ?? 0))}
        </span>
        <span title={snapshot?.sessionStartedAt}>
          {t('logs.sessionOnly').replace('{limit}', String(snapshot?.limit ?? 1000))}
        </span>
        {!!snapshot?.dropped && (
          <span>{t('logs.dropped').replace('{count}', String(snapshot.dropped))}</span>
        )}
        <Badge variant={autoRefresh ? 'success' : 'secondary'} className="ms-auto">
          {t(autoRefresh ? 'logs.live' : 'logs.paused')}
        </Badge>
      </div>
      <AppLogDetailDialog entry={selected} onClose={() => setSelected(undefined)} />
      <ConfirmActionDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('logs.clearTitle')}
        description={t('logs.clearDescription')}
        actionLabel={t('logs.clear')}
        pending={clear.isPending}
        destructive
        onConfirm={() =>
          clear.mutate(undefined, {
            onSuccess: () => {
              setConfirmClear(false)
              setSelected(undefined)
            },
          })
        }
      />
    </section>
  )
}
