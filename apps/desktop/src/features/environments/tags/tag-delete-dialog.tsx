import { useState } from 'react'
import type { EnvironmentTag } from '@contextweave/contracts'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useOrganization, useOrganizationCommand } from '../organization/use-organization'

export function TagDeleteDialog({
  tag,
  onClose,
  onDeleted,
}: {
  tag: EnvironmentTag
  onClose: () => void
  onDeleted: () => void
}) {
  const { t } = useI18n(),
    api = useWorkspaceApi()
  const query = useOrganization(),
    command = useOrganizationCommand()
  const [target, setTarget] = useState(tag)
  const reload = async () => {
    const result = await query.refetch()
    if (!result.isSuccess) return
    const fresh = result.data.tags.find((item) => item.id === tag.id)
    if (fresh) {
      setTarget(fresh)
      command.clearError()
    } else onClose()
  }
  return (
    <ConfirmActionDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${t('tags.delete')}: ${target.name}`}
      description={t('tags.deleteHelp')}
      actionLabel={t('tags.delete')}
      destructive
      pending={command.pending}
      onConfirm={() =>
        void command.run(
          () => api.organization.deleteTag({ id: target.id, expectedRevision: target.revision }),
          onDeleted,
        )
      }
    >
      {(command.error || query.error) && (
        <Alert variant="destructive">
          <AlertDescription>
            {command.error ?? query.error?.message}
            <Button
              variant="link"
              disabled={command.pending || query.isFetching}
              onClick={() => void reload()}
            >
              {t('org.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </ConfirmActionDialog>
  )
}
