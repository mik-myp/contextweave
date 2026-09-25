import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useI18n } from '@/i18n'
import type { useKernelRemoval } from '../hooks/use-kernel-removal'

export function KernelRemoveDialog({ removal }: { removal: ReturnType<typeof useKernelRemoval> }) {
  const { t } = useI18n()
  return (
    <ConfirmActionDialog
      open={Boolean(removal.selected)}
      onOpenChange={(open) => {
        if (!open) removal.select()
      }}
      title={t('kernel.removeTitle').replace('{name}', removal.selected?.label ?? '')}
      description={t('kernel.removeDescription').replace(
        '{count}',
        String(removal.selected?.referenceCount ?? 0),
      )}
      actionLabel={t('kernel.remove')}
      destructive
      pending={removal.pending}
      onConfirm={() => void removal.confirm()}
    >
      {removal.error && (
        <Alert variant="destructive">
          <AlertDescription>{removal.error}</AlertDescription>
        </Alert>
      )}
    </ConfirmActionDialog>
  )
}
