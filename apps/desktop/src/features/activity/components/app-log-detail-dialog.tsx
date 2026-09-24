import type { AppLogEntry } from '@contextweave/contracts'
import { CopyIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { unwrapIpc } from '@/shared/lib/ipc'
import { describeLogEntry, logLevelVariants } from '../lib/log-labels'

export function AppLogDetailDialog({
  entry,
  onClose,
}: {
  entry?: AppLogEntry
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const copy = async () => {
    if (!entry) return
    try {
      await unwrapIpc(window.contextweave.logs.copy(entry.id))
      toast.add({ type: 'success', description: t('logs.copied') })
    } catch (cause) {
      toast.add({
        type: 'error',
        description: cause instanceof Error ? cause.message : t('logs.copyFailed'),
      })
    }
  }
  return (
    <Dialog
      open={!!entry}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('logs.details')}</DialogTitle>
          <DialogDescription>{t('logs.detailsHelp')}</DialogDescription>
        </DialogHeader>
        {entry && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={logLevelVariants[entry.level]}>
                {t(`logs.level.${entry.level}`)}
              </Badge>
              <Badge variant="secondary">{t(`logs.source.${entry.source}`)}</Badge>
              <time className="text-sm text-muted-foreground" dateTime={entry.timestamp}>
                {new Date(entry.timestamp).toLocaleString(locale)}
              </time>
            </div>
            <p className="text-sm break-words">{describeLogEntry(entry, t)}</p>
            <pre
              dir="ltr"
              className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed select-text"
            >
              {JSON.stringify(entry, null, 2)}
            </pre>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void copy()}>
            <CopyIcon data-icon="inline-start" />
            {t('logs.copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
