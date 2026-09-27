import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { useBatchPreview, useBatchCommand, type BatchRequest } from './use-batches'
export function BatchPreviewDialog({
  request,
  onClose,
  onCreated,
}: {
  request: BatchRequest
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const api = useWorkspaceApi(),
    { t } = useI18n(),
    preview = useBatchPreview(request),
    command = useBatchCommand()
  const ready = preview.data?.targets.filter((item) => item.reason === null).length ?? 0
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('batch.previewTitle')}</DialogTitle>
          <DialogDescription>{t('batch.previewHelp')}</DialogDescription>
        </DialogHeader>
        {preview.loading && (
          <p role="status" className="flex items-center gap-2">
            <Spinner />
            {t('batch.loading')}
          </p>
        )}
        {(preview.error || command.error) && (
          <Alert variant="destructive">
            <AlertDescription>{preview.error || command.error}</AlertDescription>
          </Alert>
        )}
        {preview.data && (
          <>
            <p className="text-sm">
              {t(`batch.action.${preview.data.action}`)} ·{' '}
              {t('batch.previewCount')
                .replace('{ready}', String(ready))
                .replace('{total}', String(preview.data.targets.length))}
            </p>
            <div className="min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('env.name')}</TableHead>
                    <TableHead>{t('batch.revision')}</TableHead>
                    <TableHead>{t('batch.result')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.data.targets.map((item) => (
                    <TableRow key={item.environmentId}>
                      <TableCell>
                        <span className="block max-w-64 truncate" title={item.name}>
                          {item.name || '—'}
                        </span>
                        <span
                          className="block max-w-64 truncate text-xs text-muted-foreground"
                          title={item.environmentId}
                        >
                          {item.environmentId}
                        </span>
                      </TableCell>
                      <TableCell>{item.revision ?? '—'}</TableCell>
                      <TableCell>
                        {item.reason ? (
                          errorMessage(item.reason)
                        ) : (
                          <Badge variant="secondary">{t('batch.ready')}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={command.pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={command.pending || preview.loading}
            onClick={() => {
              command.clearError()
              preview.reload()
            }}
          >
            {t('batch.refreshPreview')}
          </Button>
          <Button
            variant={preview.data?.action === 'trash' ? 'destructive' : 'default'}
            disabled={command.pending || preview.loading || !preview.data || !ready}
            onClick={() => {
              const id = preview.data?.id
              if (id)
                void command.run(
                  () => api.batch.confirm(id),
                  (task) => {
                    onCreated(task.id)
                    onClose()
                  },
                )
            }}
          >
            {command.pending && <Spinner data-icon="inline-start" />}
            {t('batch.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
