import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/i18n'

export function EnvironmentConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  kind,
  pending = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  kind: 'stop' | 'discard'
  pending?: boolean
}) {
  const { t } = useI18n()
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(kind === 'stop' ? 'env.stopTitle' : 'env.leaveTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(kind === 'stop' ? 'env.stopDescription' : 'env.leaveDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t(kind === 'discard' ? 'env.keepEditing' : 'common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {pending && <Spinner data-icon="inline-start" />}
            {t(pending ? 'env.processing' : kind === 'stop' ? 'env.stop' : 'env.discard')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
