import { useId, useState } from 'react'
import { TagCatalogPicker } from '../tags/tag-catalog-picker'
import { saveEnvironmentOrganizationSchema } from '@contextweave/contracts'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import {
  useOrganization,
  useOrganizationCommand,
  type OrganizedEnvironment,
} from './use-organization'

export function EnvironmentOrganizationDialog({
  environment,
  onClose,
}: {
  environment: OrganizedEnvironment
  onClose: () => void
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi(),
    query = useOrganization(),
    command = useOrganizationCommand(),
    id = useId()
  const [draft, setDraft] = useState({
    groupId: environment.groupId ?? 'ungrouped',
    tags: environment.tags.join('\n'),
    note: environment.note,
    revision: environment.organizationRevision,
  })
  const [invalid, setInvalid] = useState(false)
  const groups = query.data?.groups ?? []
  const items = [
    { value: 'ungrouped', label: t('org.ungrouped') },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ]
  if (!items.some((item) => item.value === draft.groupId))
    items.push({ value: draft.groupId, label: draft.groupId })
  const save = () => {
    const value = saveEnvironmentOrganizationSchema.safeParse({
      environmentId: environment.id,
      groupId: draft.groupId === 'ungrouped' ? null : draft.groupId,
      tags: draft.tags
        .split('\n')
        .map((tag) => tag.trim())
        .filter(Boolean),
      note: draft.note,
      expectedRevision: draft.revision,
    })
    setInvalid(!value.success)
    if (value.success) void command.run(() => api.organization.saveEnvironment(value.data), onClose)
  }
  const reload = async () => {
    const result = await query.refetch()
    const current = result.data?.environments.find((e) => e.environmentId === environment.id)
    if (current) {
      setDraft({
        groupId: current.groupId ?? 'ungrouped',
        tags: current.tags.join('\n'),
        note: current.note,
        revision: current.revision,
      })
      setInvalid(false)
      command.clearError()
    }
  }
  const blocked = command.pending || query.isPending || query.isError
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('org.edit')}</DialogTitle>
          <DialogDescription>
            {environment.name} · {t('org.editHelp')}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) save()
          }}
          className="flex flex-col gap-4"
        >
          {(command.error || query.error || invalid) && (
            <Alert variant="destructive">
              <AlertDescription>
                {command.error ?? query.error?.message ?? t('org.invalid')}
                <Button
                  type="button"
                  variant="link"
                  disabled={command.pending}
                  onClick={() => void reload()}
                >
                  {t('org.reload')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field data-disabled={blocked}>
              <FieldLabel htmlFor={`${id}-group`}>{t('org.group')}</FieldLabel>
              <Select
                items={items}
                value={draft.groupId}
                onValueChange={(value) => setDraft({ ...draft, groupId: value ?? 'ungrouped' })}
                disabled={blocked}
              >
                <SelectTrigger id={`${id}-group`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <TagCatalogPicker
              tags={query.data?.tags ?? []}
              value={draft.tags}
              onChange={(tags) => setDraft({ ...draft, tags })}
              disabled={blocked}
            />
            <Field data-invalid={invalid} data-disabled={blocked}>
              <FieldLabel htmlFor={`${id}-tags`}>{t('org.tags')}</FieldLabel>
              <Textarea
                id={`${id}-tags`}
                value={draft.tags}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                disabled={blocked}
                aria-invalid={invalid}
                aria-describedby={`${id}-tags-help`}
                maxLength={1000}
              />
              <FieldDescription id={`${id}-tags-help`}>{t('org.tagsHelp')}</FieldDescription>
            </Field>
            <Field data-invalid={invalid} data-disabled={blocked}>
              <FieldLabel htmlFor={`${id}-note`}>{t('org.note')}</FieldLabel>
              <Textarea
                id={`${id}-note`}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                disabled={blocked}
                maxLength={4000}
                aria-describedby={`${id}-note-help`}
                rows={5}
              />
              <FieldDescription id={`${id}-note-help`}>{t('org.noteHelp')}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={command.pending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={blocked}>
              {command.pending && <Spinner data-icon="inline-start" />}
              {t('org.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
