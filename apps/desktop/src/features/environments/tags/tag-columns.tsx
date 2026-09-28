import type { ColumnDef } from '@tanstack/react-table'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { organizationNameKey, type EnvironmentTag } from '@contextweave/contracts'
import type { I18nContextValue } from '@/i18n'
import type { DataTableFeatures } from '@/components/data-table/data-table-features'
import { DataTableRowActions } from '@/components/data-table/data-table-row-actions'
import { Badge } from '@/components/ui/badge'
import type { tagUsage } from './tag-usage'

export function tagColumns({
  t,
  locale,
  usage,
  onEdit,
  onDelete,
}: {
  t: I18nContextValue['t']
  locale: string
  usage: ReturnType<typeof tagUsage>
  onEdit: (tag: EnvironmentTag) => void
  onDelete: (tag: EnvironmentTag) => void
}): ColumnDef<DataTableFeatures, EnvironmentTag, unknown>[] {
  return [
    {
      accessorKey: 'name',
      header: t('tags.name'),
      meta: { label: t('tags.name') },
      enableHiding: false,
      cell: ({ row }) => <Badge variant="secondary">{row.original.name}</Badge>,
    },
    {
      id: 'environments',
      accessorFn: (row) => usage.environments.get(organizationNameKey(row.name)) ?? 0,
      header: t('tags.environments'),
      meta: { label: t('tags.environments') },
      enableGlobalFilter: false,
    },
    {
      id: 'views',
      accessorFn: (row) => usage.views.get(organizationNameKey(row.name)) ?? 0,
      header: t('tags.views'),
      meta: { label: t('tags.views') },
      enableGlobalFilter: false,
    },
    {
      accessorKey: 'updatedAt',
      header: t('tags.updatedAt'),
      meta: { label: t('tags.updatedAt') },
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <time dateTime={row.original.updatedAt} className="whitespace-nowrap tabular-nums">
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(row.original.updatedAt),
          )}
        </time>
      ),
    },
    {
      id: 'actions',
      header: t('tags.actions'),
      meta: { label: t('tags.actions'), align: 'end' },
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DataTableRowActions
          label={`${t('tags.actions')}: ${row.original.name}`}
          actions={[
            {
              id: 'rename',
              label: t('tags.rename'),
              icon: PencilIcon,
              onClick: () => onEdit(row.original),
            },
            {
              id: 'delete',
              label: t('tags.delete'),
              icon: Trash2Icon,
              destructive: true,
              onClick: () => onDelete(row.original),
            },
          ]}
        />
      ),
    },
  ]
}
