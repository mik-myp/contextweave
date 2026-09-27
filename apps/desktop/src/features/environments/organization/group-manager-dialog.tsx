import { useId, useState } from 'react'
import { organizationNameSchema, type EnvironmentGroup } from '@contextweave/contracts'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { useOrganization, useOrganizationCommand } from './use-organization'

function GroupRow({
  group,
  onDelete,
  command,
}: {
  group: EnvironmentGroup
  onDelete: () => void
  command: ReturnType<typeof useOrganizationCommand>
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi(),
    id = useId()
  const [draft, setDraft] = useState({ name: group.name, revision: group.revision })
  const valid = organizationNameSchema.safeParse(draft.name)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid.success) return
        void command.run(
          () =>
            api.organization.updateGroup({
              id: group.id,
              name: valid.data,
              expectedRevision: draft.revision,
            }),
          (saved) => setDraft({ name: saved.name, revision: saved.revision }),
        )
      }}
    >
      <Field orientation="horizontal">
        <FieldLabel htmlFor={id} className="sr-only">
          {t('org.rename')}: {group.name}
        </FieldLabel>
        <Input
          id={id}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          disabled={command.pending}
          maxLength={80}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={command.pending || !valid.success || draft.name === group.name}
        >
          {t('org.rename')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={command.pending}
          onClick={onDelete}
        >
          {t('org.delete')}
        </Button>
      </Field>
      {draft.revision !== group.revision && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('error.ORGANIZATION_CONFLICT')}
            <Button
              type="button"
              variant="link"
              disabled={command.pending}
              onClick={() => {
                setDraft({ name: group.name, revision: group.revision })
                command.clearError()
              }}
            >
              {t('org.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </form>
  )
}
export function GroupManagerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(),
    query = useOrganization(),
    api = useWorkspaceApi(),
    command = useOrganizationCommand(),
    id = useId()
  const [name, setName] = useState(''),
    [target, setTarget] = useState<EnvironmentGroup>()
  const value = organizationNameSchema.safeParse(name),
    pending = command.pending
  const affected = query.data?.environments.filter((e) => e.groupId === target?.id).length ?? 0
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('org.groups')}</DialogTitle>
          <DialogDescription>{t('org.groupHelp')}</DialogDescription>
        </DialogHeader>
        {(command.error || query.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {command.error ?? query.error?.message}
              <Button variant="link" disabled={pending} onClick={() => void query.refetch()}>
                {t('common.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (value.success)
              void command.run(
                () => api.organization.createGroup({ name: value.data }),
                () => setName(''),
              )
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={id}>{t('org.newGroup')}</FieldLabel>
              <Input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                disabled={pending}
                autoComplete="off"
              />
              <Button type="submit" disabled={pending || !value.success || !query.data}>
                {t('org.newGroup')}
              </Button>
            </Field>
          </FieldGroup>
        </form>
        <Separator />
        <div className="flex max-h-80 flex-col gap-3 overflow-auto">
          {query.isPending ? (
            <p role="status">{t('workspace.loading')}</p>
          ) : query.data?.groups.length ? (
            query.data.groups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                onDelete={() => setTarget(group)}
                command={command}
              />
            ))
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('org.noGroups')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        <ConfirmActionDialog
          open={!!target}
          onOpenChange={(open) => {
            if (!open) setTarget(undefined)
          }}
          title={t('org.deleteGroupTitle')}
          description={`${target?.name ?? ''} · ${t('org.affected').replace('{count}', String(affected))} · ${t('org.deleteGroupHelp')}`}
          actionLabel={t('org.delete')}
          destructive
          pending={command.pending}
          onConfirm={() => {
            if (target)
              void command.run(
                () =>
                  api.organization.deleteGroup({
                    id: target.id,
                    expectedRevision: target.revision,
                  }),
                () => setTarget(undefined),
              )
          }}
        >
          <span role="alert">{command.error}</span>
        </ConfirmActionDialog>
      </DialogContent>
    </Dialog>
  )
}
