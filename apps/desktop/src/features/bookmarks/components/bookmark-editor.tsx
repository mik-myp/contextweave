import { useId, useState } from 'react'
import { bookmarkSchema, type Bookmark } from '@contextweave/contracts'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'

export function BookmarkEditor({
  bookmark,
  isDisabled,
  onApply,
  onClose,
}: {
  bookmark: Bookmark | null
  isDisabled: boolean
  onApply(bookmark: Bookmark): void
  onClose(): void
}) {
  const { t } = useI18n()
  const fieldId = useId()
  const [name, setName] = useState(bookmark?.name ?? '')
  const [url, setUrl] = useState(bookmark?.url ?? '')
  const [id] = useState(() => bookmark?.id ?? crypto.randomUUID())
  const [isSubmitted, setSubmitted] = useState(false)
  const parsed = bookmarkSchema.safeParse({ id, name, url })
  const invalid = (field: string) =>
    isSubmitted && !parsed.success && parsed.error.issues.some((issue) => issue.path[0] === field)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(bookmark ? 'bookmarks.edit' : 'bookmarks.add')}</DialogTitle>
          <DialogDescription>{t('bookmarks.urlHelp')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            if (parsed.success && !isDisabled) onApply(parsed.data)
          }}
        >
          <FieldGroup>
            <Field data-invalid={invalid('name')}>
              <FieldLabel htmlFor={`${fieldId}-name`}>{t('bookmarks.name')}</FieldLabel>
              <Input
                id={`${fieldId}-name`}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={invalid('name')}
                aria-describedby={invalid('name') ? `${fieldId}-name-error` : undefined}
              />
              {invalid('name') && (
                <FieldError id={`${fieldId}-name-error`}>{t('bookmarks.invalidName')}</FieldError>
              )}
            </Field>
            <Field data-invalid={invalid('url')}>
              <FieldLabel htmlFor={`${fieldId}-url`}>{t('bookmarks.url')}</FieldLabel>
              <Input
                id={`${fieldId}-url`}
                dir="ltr"
                type="url"
                maxLength={4096}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                aria-invalid={invalid('url')}
                aria-describedby={invalid('url') ? `${fieldId}-url-error` : undefined}
                placeholder="https://example.com"
              />
              {invalid('url') && (
                <FieldError id={`${fieldId}-url-error`}>{t('bookmarks.urlHelp')}</FieldError>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isDisabled}>
              {t('bookmarks.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
