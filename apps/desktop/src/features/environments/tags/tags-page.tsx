import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
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
  const [editor, setEditor] = useState<{ tag?: EnvironmentTag }>()
  const [deleting, setDeleting] = useState<EnvironmentTag>()
  const [notice, setNotice] = useState<TranslationKey>()
  const usage = useMemo(() => tagUsage(query.data), [query.data])
  const columns = useMemo(
    () =>
      tagColumns({ t, locale, usage, onEdit: (tag) => setEditor({ tag }), onDelete: setDeleting }),
    [t, locale, usage],
  )
  const table = useDataTable({
    data: query.data?.tags ?? [],
    columns,
    getRowId,
    stateKey: 'tags',
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
      <p className="text-sm text-muted-foreground">{t('tags.description')}</p>
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
        loading={query.isPending}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        emptyTitle={t('tags.empty')}
        emptyDescription={t('tags.emptyHelp')}
        emptyAction={table.state.globalFilter ? undefined : create}
      />
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
