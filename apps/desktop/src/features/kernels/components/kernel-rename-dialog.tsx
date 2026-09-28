import { useRef, useState } from 'react'
import { renameKernelSchema, type KernelSummary } from '@contextweave/contracts'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function KernelRenameDialog({
  kernel,
  onClose,
}: {
  kernel: KernelSummary
  onClose(): void
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi(),
    { refresh } = useAppData(['kernels'])
  const [name, setName] = useState(kernel.customName ?? '')
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>()
  const busy = useRef(false)
  const parsed = renameKernelSchema.safeParse({ id: kernel.id, name })
  const save = async () => {
    if (busy.current || !parsed.success) return
    busy.current = true
    setPending(true)
    setError(undefined)
    try {
      await unwrapIpc(api.kernel.rename(parsed.data))
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.operationError'))
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('kernel.rename')}</DialogTitle>
          <DialogDescription>{t('kernel.renameHelp')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field data-invalid={!parsed.success || undefined}>
            <FieldLabel htmlFor="kernel-custom-name">{t('kernel.name')}</FieldLabel>
            <Input
              id="kernel-custom-name"
              value={name}
              maxLength={80}
              disabled={pending}
              autoFocus
              aria-invalid={!parsed.success || undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {!parsed.success && <FieldError>{t('kernel.invalidName')}</FieldError>}
          </Field>
          <DialogFooter>
            <Button variant="outline" type="button" disabled={pending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !parsed.success}>
              {t('admin.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
