import { useState } from 'react'
import { importProxiesInputSchema, proxyTypeSchema, type ProxyType } from '@contextweave/contracts'
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useImportProxies } from '../use-import-proxies'

export function ProxyImportDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [defaultType, setDefaultType] = useState<ProxyType>('http')
  const [invalid, setInvalid] = useState(false)
  const command = useImportProxies()
  const protocols = proxyTypeSchema.options.map((value) => ({ value, label: value.toUpperCase() }))
  const submit = async () => {
    if (command.isPending) return
    const parsed = importProxiesInputSchema.safeParse({ text, defaultType })
    if (!parsed.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    try {
      const results = await command.mutateAsync(parsed.data)
      const failed = new Set(results.filter((row) => row.status === 'error').map((row) => row.line))
      // Do not retain successfully imported passwords in dialog state.
      setText(
        text
          .split(/\r?\n/)
          .filter((_, index) => failed.has(index + 1))
          .join('\n'),
      )
    } catch {
      /* Mutation state renders a localized error; never render the input or raw parser errors. */
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.isPending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('proxy.import.title')}</DialogTitle>
          <DialogDescription>{t('proxy.import.description')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="proxy-import-protocol">{t('proxy.import.defaultType')}</FieldLabel>
            <Select
              value={defaultType}
              items={protocols}
              onValueChange={(value) => {
                const result = proxyTypeSchema.safeParse(value)
                if (result.success) setDefaultType(result.data)
              }}
              disabled={command.isPending}
            >
              <SelectTrigger id="proxy-import-protocol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {protocols.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={invalid}>
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
              autoComplete="off"
              spellCheck={false}
              placeholder={
                'http://127.0.0.1:8080\nhttps://user:password@proxy.example:443\nsocks5://127.0.0.1:1080\n127.0.0.1:8080:user:password'
              }
            />
            <FieldDescription>{t('proxy.import.help')}</FieldDescription>
            {invalid && <FieldError>{t('proxy.import.limit')}</FieldError>}
          </Field>
        </FieldGroup>
        {command.error && (
          <Alert variant="destructive">
            <AlertDescription>{command.error.message}</AlertDescription>
          </Alert>
        )}
        {command.data && (
          <Alert>
            <AlertDescription>
              <p role="status">
                {t('proxy.import.summary')
                  .replace(
                    '{created}',
                    String(command.data.filter((row) => row.status === 'created').length),
                  )
                  .replace(
                    '{skipped}',
                    String(command.data.filter((row) => row.status === 'skipped').length),
                  )
                  .replace(
                    '{failed}',
                    String(command.data.filter((row) => row.status === 'error').length),
                  )}
              </p>
              <ul className="max-h-40 overflow-y-auto">
                {command.data
                  .filter((row) => row.status !== 'created')
                  .map((row) => (
                    <li key={row.line}>
                      {t('proxy.import.line').replace('{line}', String(row.line))}:{' '}
                      {t(
                        row.code === 'PROXY_ALREADY_EXISTS'
                          ? 'proxy.import.duplicate'
                          : row.code === 'CREDENTIAL_UNAVAILABLE'
                            ? 'proxy.import.secureUnavailable'
                            : row.code === 'PROXY_SAVE_FAILED'
                              ? 'proxy.import.saveFailed'
                              : 'proxy.import.invalid',
                      )}
                    </li>
                  ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={command.isPending} onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button disabled={command.isPending || !text.trim()} onClick={() => void submit()}>
            {command.isPending && <Spinner data-icon="inline-start" />}
            {t('proxy.import.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
