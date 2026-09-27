import { useId, useState } from 'react'
import { organizationNameSchema, type SavedEnvironmentView } from '@contextweave/contracts'
import type { ReactTable } from '@tanstack/react-table'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
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
import {
  useOrganization,
  useOrganizationCommand,
  type OrganizedEnvironment,
} from './use-organization'
import { applyEnvironmentView, captureEnvironmentView } from './view-state'
type EnvironmentTable = ReactTable<DataTableFeatures, OrganizedEnvironment>
function ViewRow({
  view,
  table,
  command,
  onApply,
  onDelete,
}: {
  view: SavedEnvironmentView
  table: EnvironmentTable
  command: ReturnType<typeof useOrganizationCommand>
  onApply: () => void
  onDelete: () => void
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi(),
    id = useId()
  const [draft, setDraft] = useState({ name: view.name, revision: view.revision })
  const valid = organizationNameSchema.safeParse(draft.name)
  const save = (replace: boolean) => {
    if (valid.success)
      void command.run(
        async () =>
          api.organization.updateView({
            id: view.id,
            name: valid.data,
            view: replace ? captureEnvironmentView(table) : view.view,
            expectedRevision: draft.revision,
          }),
        (saved) => setDraft({ name: saved.name, revision: saved.revision }),
      )
  }
  return (
    <div className="flex flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={id} className="sr-only">
          {t('org.viewName')}: {view.name}
        </FieldLabel>
        <Input
          id={id}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          maxLength={80}
          disabled={command.pending}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onApply} disabled={command.pending}>
          {t('org.applyView')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={command.pending || !valid.success || draft.name === view.name}
          onClick={() => save(false)}
        >
          {t('org.rename')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={command.pending || !valid.success}
          onClick={() => save(true)}
        >
          {t('org.updateView')}
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
      </div>
      {draft.revision !== view.revision && (
        <Alert>
          <AlertDescription>
            {t('error.ORGANIZATION_CONFLICT')}
            <Button
              type="button"
              variant="link"
              disabled={command.pending}
              onClick={() => {
                setDraft({ name: view.name, revision: view.revision })
                command.clearError()
              }}
            >
              {t('org.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
export function SavedViewsDialog({
  table,
  onClose,
}: {
  table: EnvironmentTable
  onClose: () => void
}) {
  const { t } = useI18n(),
    query = useOrganization(),
    api = useWorkspaceApi(),
    command = useOrganizationCommand(),
    id = useId()
  const [name, setName] = useState(''),
    [target, setTarget] = useState<SavedEnvironmentView>()
  const value = organizationNameSchema.safeParse(name)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('org.views')}</DialogTitle>
          <DialogDescription>{t('org.viewHelp')}</DialogDescription>
        </DialogHeader>
        {(command.error || query.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {command.error ?? query.error?.message}
              <Button
                variant="link"
                disabled={command.pending}
                onClick={() => void query.refetch()}
              >
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
                async () =>
                  api.organization.createView({
                    name: value.data,
                    view: captureEnvironmentView(table),
                  }),
                () => setName(''),
              )
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={id}>{t('org.viewName')}</FieldLabel>
              <Input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                disabled={command.pending}
                autoComplete="off"
              />
            </Field>
            <Button type="submit" disabled={command.pending || !value.success || !query.data}>
              {t('org.saveView')}
            </Button>
          </FieldGroup>
        </form>
        <Separator />
        <div className="flex max-h-80 flex-col gap-4 overflow-auto">
          {query.isPending ? (
            <p role="status">{t('workspace.loading')}</p>
          ) : query.data?.views.length ? (
            query.data.views.map((view) => (
              <ViewRow
                key={view.id}
                view={view}
                table={table}
                command={command}
                onApply={() => {
                  applyEnvironmentView(table, view.view)
                  onClose()
                }}
                onDelete={() => setTarget(view)}
              />
            ))
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('org.noViews')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        <ConfirmActionDialog
          open={!!target}
          onOpenChange={(open) => {
            if (!open) setTarget(undefined)
          }}
          title={t('org.deleteViewTitle')}
          description={`${target?.name ?? ''} · ${t('org.deleteViewHelp')}`}
          actionLabel={t('org.delete')}
          destructive
          pending={command.pending}
          onConfirm={() => {
            if (target)
              void command.run(
                () =>
                  api.organization.deleteView({ id: target.id, expectedRevision: target.revision }),
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
