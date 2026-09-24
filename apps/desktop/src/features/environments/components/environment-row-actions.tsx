import { Link } from '@tanstack/react-router'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { EyeIcon, PencilIcon, PlayIcon, SquareIcon, Trash2Icon } from 'lucide-react'
import {
  DataTableRowActions,
  type DataTableRowAction,
} from '@/components/data-table/data-table-row-actions'
import { useI18n } from '@/i18n'
import { isEnvironmentReadOnly } from '../environment-service'

export function EnvironmentRowActions({
  environment,
  pending,
  onStart,
  onStop,
  onDelete,
}: {
  environment: EnvironmentSummary
  pending: boolean
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const active = environment.status === 'running' || environment.status === 'starting'
  const readOnly = isEnvironmentReadOnly(environment.status)
  const needsReview = environment.status === 'error' || environment.status === 'needs-recovery'
  const edit: DataTableRowAction = {
    id: 'edit',
    label: t(readOnly || needsReview ? 'env.view' : 'env.edit'),
    icon: readOnly || needsReview ? EyeIcon : PencilIcon,
    disabled: pending,
    render: (
      <Link to="/environments/$environmentId/edit" params={{ environmentId: environment.id }} />
    ),
  }
  const run: DataTableRowAction = {
    id: 'run',
    label: t(
      environment.status === 'stopping' ? 'status.stopping' : active ? 'env.stop' : 'env.start',
    ),
    icon: active || environment.status === 'stopping' ? SquareIcon : PlayIcon,
    disabled: environment.status === 'stopping' || (pending && environment.status !== 'starting'),
    pending,
    onClick: active ? onStop : onStart,
  }
  return (
    <DataTableRowActions
      label={`${t('env.actions')}: ${environment.name}`}
      actions={[
        ...(environment.status === 'needs-recovery'
          ? [edit]
          : needsReview
            ? [edit, run]
            : [run, edit]),
        {
          id: 'trash',
          label: t('life.op.trash'),
          icon: Trash2Icon,
          destructive: true,
          disabled: pending || readOnly,
          disabledReason: readOnly ? t('env.stopBeforeTrash') : undefined,
          onClick: onDelete,
        },
      ]}
    />
  )
}
