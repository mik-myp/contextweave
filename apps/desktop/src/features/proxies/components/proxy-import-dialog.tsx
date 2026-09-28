import { useRef, useState } from 'react'
import { importProxiesInputSchema } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useImportProxies } from '../use-import-proxies'
import { ProxyImportResults } from './proxy-import-results'

export function ProxyImportDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const submitting = useRef(false)
  const command = useImportProxies()
  const submit = async () => {
    if (submitting.current) return
    const parsed = importProxiesInputSchema.safeParse({ text })
    if (!parsed.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    submitting.current = true
    try {
      await command.mutateAsync(parsed.data)
      // Clear every source line, including failures; only Main's redacted results remain visible.
      setText('')
    } catch {
      /* Mutation state renders a localized error; never render raw parser or transport errors. */
    } finally {
      submitting.current = false
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('proxy.import.title')}</DialogTitle>
          <DialogDescription>{t('proxy.import.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FieldGroup>
            <Field data-invalid={invalid} data-disabled={command.isPending}>
              <FieldLabel htmlFor="proxy-import-text">{t('proxy.import.lines')}</FieldLabel>
              <Textarea
                id="proxy-import-text"
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setInvalid(false)
                }}
                disabled={command.isPending}
                rows={7}
                maxLength={65536}
                aria-invalid={invalid}
                aria-describedby={`proxy-import-help${invalid ? ' proxy-import-error' : ''}`}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  '127.0.0.1:8080\nhttps://user:password@proxy.example:443\nsocks5://127.0.0.1:1080\n127.0.0.1:8080:user:password'
                }
              />
              <FieldDescription id="proxy-import-help">{t('proxy.import.help')}</FieldDescription>
              {invalid && (
                <FieldError id="proxy-import-error">{t('proxy.import.limit')}</FieldError>
              )}
            </Field>
          </FieldGroup>
          {command.error && (
            <Alert variant="destructive">
              <AlertDescription>{command.error.message}</AlertDescription>
            </Alert>
          )}
          {command.data && <ProxyImportResults rows={command.data} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={command.isPending} onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button type="submit" disabled={command.isPending || !text.trim()}>
              {command.isPending && <Spinner data-icon="inline-start" />}
              {t('proxy.import.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
