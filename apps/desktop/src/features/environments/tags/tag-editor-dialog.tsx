import { useId, useState } from 'react'
import { organizationNameKey, tagSchema, type EnvironmentTag } from '@contextweave/contracts'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
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
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useOrganization, useOrganizationCommand } from '../organization/use-organization'

export function TagEditorDialog({
  tag,
  onClose,
  onSaved,
}: {
  tag?: EnvironmentTag
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi(),
    id = useId()
  const query = useOrganization(),
    command = useOrganizationCommand()
  // Keep the original CAS baseline and draft when background events refresh the dictionary.
  const [draft, setDraft] = useState({ name: tag?.name ?? '', revision: tag?.revision })
  const [submitted, setSubmitted] = useState(false)
  const value = tagSchema.safeParse(draft.name)
  const duplicate =
    value.success &&
    query.data?.tags.some(
      (item) =>
        item.id !== tag?.id && organizationNameKey(item.name) === organizationNameKey(value.data),
    )
  const current = tag ? query.data?.tags.find((item) => item.id === tag.id) : undefined
  const stale = !!tag && !!query.data && current?.revision !== draft.revision
  const invalid = submitted && (!value.success || duplicate)
  const blocked = command.pending || query.isPending || query.isError || stale
  const reload = async () => {
    const result = await query.refetch()
    if (!result.isSuccess) return
    const fresh = result.data.tags.find((item) => item.id === tag?.id)
    if (tag && !fresh) return
    setDraft({ name: fresh?.name ?? draft.name, revision: fresh?.revision })
    setSubmitted(false)
    command.clearError()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(tag ? 'tags.rename' : 'tags.create')}</DialogTitle>
          <DialogDescription>{t(tag ? 'tags.renameHelp' : 'tags.createHelp')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            if (blocked || !value.success || duplicate) return
            void command.run(
              () =>
                tag && draft.revision !== undefined
                  ? api.organization.updateTag({
                      id: tag.id,
                      name: value.data,
                      expectedRevision: draft.revision,
                    })
                  : api.organization.createTag({ name: value.data }),
              onSaved,
            )
          }}
        >
          {(command.error || query.error || stale) && (
            <Alert variant="destructive">
              <AlertDescription>
                {command.error ??
                  query.error?.message ??
                  t(current ? 'error.ORGANIZATION_CONFLICT' : 'tags.missing')}
                <Button
                  type="button"
                  variant="link"
                  disabled={command.pending || query.isFetching}
                  onClick={() => void reload()}
                >
                  {t('org.reload')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field data-invalid={invalid} data-disabled={command.pending}>
              <FieldLabel htmlFor={id}>{t('tags.name')}</FieldLabel>
              <Input
                id={id}
                autoFocus
                value={draft.name}
                maxLength={40}
                disabled={command.pending}
                aria-invalid={invalid}
                aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <FieldDescription id={`${id}-help`}>{t('tags.nameHelp')}</FieldDescription>
              {invalid && (
                <FieldError id={`${id}-error`}>
                  {t(duplicate ? 'error.ORGANIZATION_NAME_EXISTS' : 'tags.invalid')}
                </FieldError>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={command.pending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={blocked}>
              {command.pending && <Spinner data-icon="inline-start" />}
              {t('tags.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
