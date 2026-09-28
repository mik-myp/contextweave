import { BULK_DELETE_LIMIT } from '@contextweave/contracts'
import { useQueryClient } from '@tanstack/react-query'
import {
  useWorkspaceApi,
  useWorkspaceContext,
  workspaceKey,
} from '@/features/workspaces/workspace-session-context'
import { unwrapIpc } from '@/shared/lib/ipc'
import { selectionColumn } from '@/components/data-table/data-table-selection'
import { DataTableBulkActions } from '@/components/data-table/data-table-bulk-actions'
import { BulkDeleteDialog } from '@/components/data-table/bulk-delete-dialog'
import { useMemo, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import type { EnvironmentTag } from '@contextweave/contracts'
import { useI18n, type TranslationKey } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DataTable } from '@/components/data-table/data-table'
import { useDataTable } from '@/components/data-table/use-data-table'
import { useOrganization } from '../organization/use-organization'
import { TagEditorDialog } from './tag-editor-dialog'
import { TagDeleteDialog } from './tag-delete-dialog'
import { tagColumns } from './tag-columns'
import { tagUsage } from './tag-usage'

const getRowId = (tag: EnvironmentTag) => tag.id
export function TagsPage() {
  const { t, locale } = useI18n(),
    query = useOrganization()
  const api = useWorkspaceApi(),
    context = useWorkspaceContext(),
    client = useQueryClient()
  const [bulk, setBulk] = useState<EnvironmentTag[]>()
  const [editor, setEditor] = useState<{ tag?: EnvironmentTag }>()
  const [deleting, setDeleting] = useState<EnvironmentTag>()
  const [notice, setNotice] = useState<TranslationKey>()
  const usage = useMemo(() => tagUsage(query.data), [query.data])
  const columns = useMemo(
    () => [
      selectionColumn<EnvironmentTag>(t),
      ...tagColumns({
        t,
        locale,
        usage,
        onEdit: (tag) => setEditor({ tag }),
        onDelete: setDeleting,
      }),
    ],
    [t, locale, usage],
  )
  const table = useDataTable({
    data: query.data?.tags ?? [],
    columns,
    getRowId,
    stateKey: 'tags',
    enableRowSelection: true,
    loading: query.isPending,
    initialState: { sorting: [{ id: 'name', desc: false }] },
  })
  const create = (
    <Button
      size="sm"
      disabled={query.isPending || query.isError}
      onClick={() => {
        setNotice(undefined)
        setEditor({})
      }}
    >
      <PlusIcon data-icon="inline-start" />
      {t('tags.create')}
    </Button>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">{t('tags.title')}</h1>
      {notice && (
        <Alert role="status">
          <AlertDescription>{t(notice)}</AlertDescription>
        </Alert>
      )}
      <DataTable
        table={table}
        label={t('tags.title')}
        searchPlaceholder={t('tags.search')}
        actions={create}
        bulkActions={
          <DataTableBulkActions
            table={table}
            actions={[
              {
                id: 'delete',
                label: t('table.confirmDelete'),
                icon: Trash2Icon,
                destructive: true,
                disabled:
                  !table.getFilteredSelectedRowModel().rows.length ||
                  table.getFilteredSelectedRowModel().rows.length > BULK_DELETE_LIMIT,
                disabledReason: t('table.deleteLimit').replace(
                  '{count}',
                  String(BULK_DELETE_LIMIT),
                ),
                onClick: () =>
                  setBulk(table.getFilteredSelectedRowModel().rows.map((row) => row.original)),
              },
            ]}
          />
        }
        loading={query.isPending}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        emptyTitle={t('tags.empty')}
        emptyDescription={t('tags.emptyHelp')}
        emptyAction={table.state.globalFilter ? undefined : create}
      />
      {bulk && (
        <BulkDeleteDialog
          items={bulk.map((tag) => ({ id: tag.id, label: tag.name }))}
          description={t('tags.deleteHelp')}
          onClose={() => setBulk(undefined)}
          onConfirm={async (ids) => {
            const result = await unwrapIpc(
              api.organization.deleteTags(
                bulk
                  .filter((tag) => ids.includes(tag.id))
                  .map((tag) => ({ id: tag.id, expectedRevision: tag.revision })),
              ),
            )
            await client.invalidateQueries({ queryKey: workspaceKey(context, 'organization') })
            return result
          }}
          onResult={(result) =>
            table.setRowSelection((previous) =>
              Object.fromEntries(
                Object.entries(previous).filter(
                  ([id]) => !result.some((item) => item.id === id && item.ok),
                ),
              ),
            )
          }
        />
      )}
      {editor && (
        <TagEditorDialog
          tag={editor.tag}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setNotice(editor.tag ? 'tags.renamed' : 'tags.created')
            setEditor(undefined)
          }}
        />
      )}
      {deleting && (
        <TagDeleteDialog
          tag={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setNotice('tags.deleted')
            setDeleting(undefined)
          }}
        />
      )}
    </div>
  )
}
