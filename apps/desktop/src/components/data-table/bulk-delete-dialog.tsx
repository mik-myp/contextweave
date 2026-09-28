import { useEffect, useRef, useState } from 'react'
import type { BulkDeleteResult } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from '@/components/ui/toast'

/** The caller owns deletion and cache invalidation; this component only presents its receipts. */
export function BulkDeleteDialog({
  items,
  description,
  onConfirm,
  onResult,
  onClose,
}: {
  items: { id: string; label: string }[]
  description: string
  onConfirm(ids: string[]): Promise<BulkDeleteResult>
  onResult(result: BulkDeleteResult): void
  onClose(): void
}) {
  const { t } = useI18n()
  const [remaining, setRemaining] = useState(items)
  const [error, setError] = useState<string>()
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const busy = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const confirm = async () => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(undefined)
    try {
      const result = await onConfirm(remaining.map((item) => item.id))
      if (!mounted.current) return
      onResult(result)
      const failed = result.filter((item) => !item.ok)
      const message = t('table.deleteResult')
        .replace('{success}', String(result.length - failed.length))
        .replace('{failed}', String(failed.length))
      toast.add({ title: message, type: failed.length ? 'error' : 'success' })
      if (!failed.length) onClose()
      else {
        const errors = Object.fromEntries(failed.map((item) => [item.id, errorMessage(item.code)]))
        setFailures(errors)
        setRemaining((items) => items.filter((item) => item.id in errors))
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : errorMessage('COMMAND_UNCONFIRMED'))
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return (
    <ConfirmActionDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose()
      }}
      title={t('table.deleteSelected').replace('{count}', String(remaining.length))}
      description={description}
      actionLabel={t('table.confirmDelete')}
      destructive
      pending={pending}
      onConfirm={() => void confirm()}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ul className="flex max-h-64 flex-col gap-2 overflow-auto text-sm">
        {remaining.map((item) => (
          <li key={item.id} className="flex flex-col gap-1">
            <span className="break-words">{item.label}</span>
            {failures[item.id] && <span className="text-destructive">{failures[item.id]}</span>}
          </li>
        ))}
      </ul>
      {Object.keys(failures).length > 0 && (
        <p className="text-sm text-muted-foreground">{t('table.deleteRetryHelp')}</p>
      )}
    </ConfirmActionDialog>
  )
}
