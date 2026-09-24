import { useLayoutEffect, useRef } from 'react'
import type { AppLogEntry } from '@contextweave/contracts'
import { EyeIcon, ScrollTextIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { DataTableRowActions } from '@/components/data-table/data-table-row-actions'
import { describeLogEntry, logLevelVariants } from '../lib/log-labels'

export function AppLogTable({
  entries,
  filtered,
  follow,
  onFollowChange,
  onReset,
  onSelect,
}: {
  entries: AppLogEntry[]
  filtered: boolean
  follow: boolean
  onFollowChange: (follow: boolean) => void
  onReset: () => void
  onSelect: (entry: AppLogEntry) => void
}) {
  const { t, locale } = useI18n()
  const viewport = useRef<HTMLDivElement>(null)
  const newestId = entries.at(-1)?.id
  useLayoutEffect(() => {
    if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [follow, newestId, entries.length])
  if (!entries.length)
    return (
      <Empty className="min-h-0 overflow-auto border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollTextIcon />
          </EmptyMedia>
          <EmptyTitle>{t(filtered ? 'logs.noMatches' : 'logs.empty')}</EmptyTitle>
          <EmptyDescription>
            {t(filtered ? 'logs.noMatchesHelp' : 'logs.emptyHelp')}
          </EmptyDescription>
        </EmptyHeader>
        {filtered && (
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={onReset}>
              {t('common.reset')}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    )
  const formatTime = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return (
    <Table
      containerProps={{
        ref: viewport,
        tabIndex: 0,
        role: 'region',
        'aria-label': t('logs.application'),
        className: 'min-h-0 flex-1 overflow-auto rounded-lg border focus-visible:outline-ring',
        onScroll: (event) => {
          const element = event.currentTarget
          if (follow && element.scrollHeight - element.scrollTop - element.clientHeight > 48)
            onFollowChange(false)
        },
      }}
    >
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead>{t('logs.timestamp')}</TableHead>
          <TableHead>{t('logs.level')}</TableHead>
          <TableHead>{t('logs.source')}</TableHead>
          <TableHead>{t('logs.message')}</TableHead>
          <TableHead className="text-end">{t('logs.duration')}</TableHead>
          <TableHead className="text-end">{t('env.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>
              <time
                dir="ltr"
                className="font-mono text-xs tabular-nums text-muted-foreground"
                dateTime={entry.timestamp}
                title={new Date(entry.timestamp).toLocaleString(locale)}
              >
                {formatTime.format(new Date(entry.timestamp))}
              </time>
            </TableCell>
            <TableCell>
              <Badge variant={logLevelVariants[entry.level]}>
                {t(`logs.level.${entry.level}`)}
              </Badge>
            </TableCell>
            <TableCell>
              <span className="text-muted-foreground">{t(`logs.source.${entry.source}`)}</span>
            </TableCell>
            <TableCell className="w-full min-w-64 max-w-xl whitespace-normal">
              <div className="flex flex-col gap-1">
                <p className="break-words">{describeLogEntry(entry, t)}</p>
                {(entry.method || entry.fields.resourceId) && (
                  <div
                    dir="ltr"
                    className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground"
                  >
                    {entry.method && <span>{entry.method}</span>}
                    {entry.fields.resourceId && (
                      <span className="break-all">{entry.fields.resourceId}</span>
                    )}
                  </div>
                )}
              </div>
            </TableCell>
            <TableCell className="text-end font-mono text-xs tabular-nums text-muted-foreground">
              {entry.durationMs === undefined ? '—' : `${entry.durationMs} ms`}
            </TableCell>
            <TableCell>
              <DataTableRowActions
                label={t('logs.details')}
                actions={[
                  {
                    id: 'details',
                    label: t('logs.details'),
                    icon: EyeIcon,
                    onClick: () => onSelect(entry),
                  },
                ]}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
