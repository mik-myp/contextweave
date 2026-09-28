import { useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { maxDefaultBookmarks, type Bookmark } from '@contextweave/contracts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/i18n'
import { SettingsSection } from '@/features/settings/components/settings-section'
import { BookmarkEditor } from '../components/bookmark-editor'
import { useDefaultBookmarks } from '../hooks/use-default-bookmarks'

export function SettingsBookmarksPage() {
  const { t } = useI18n()
  const state = useDefaultBookmarks()
  const [editor, setEditor] = useState<{
    bookmark: Bookmark | null
    items: Bookmark[]
    revision: number
  } | null>(null)
  const [deleting, setDeleting] = useState<{
    bookmark: Bookmark
    items: Bookmark[]
    revision: number
  } | null>(null)
  const move = (index: number, offset: number) => {
    const next = [...state.items]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    state.replace(next)
  }
  return (
    <SettingsSection title={t('bookmarks.title')} description={t('bookmarks.description')}>
      <p className="text-sm text-muted-foreground">{t('bookmarks.scopeHelp')}</p>
      {state.query.isPending ? (
        <Skeleton className="h-32" />
      ) : state.query.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.query.error.message}</AlertDescription>
          <Button
            variant="outline"
            disabled={state.query.isFetching}
            onClick={() => void state.query.refetch()}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {state.items.length} / {maxDefaultBookmarks}
            </span>
            <Button
              variant="outline"
              disabled={!state.canEdit || state.items.length >= maxDefaultBookmarks}
              onClick={() =>
                setEditor({ bookmark: null, items: state.items, revision: state.revision })
              }
            >
              <PlusIcon data-icon="inline-start" />
              {t('bookmarks.add')}
            </Button>
          </div>
          {!state.items.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookmarkIcon />
                </EmptyMedia>
                <EmptyTitle>{t('bookmarks.empty')}</EmptyTitle>
                <EmptyDescription>{t('bookmarks.emptyHelp')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol aria-label={t('bookmarks.title')} className="flex flex-col divide-y">
              {state.items.map((bookmark, index) => (
                <li key={bookmark.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="text-sm text-muted-foreground" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-medium" title={bookmark.name}>
                      {bookmark.name}
                    </p>
                    <p
                      dir="ltr"
                      className="truncate text-xs text-muted-foreground"
                      title={bookmark.url}
                    >
                      {bookmark.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('bookmarks.up')}: ${bookmark.name}`}
                      disabled={!state.canEdit || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('bookmarks.down')}: ${bookmark.name}`}
                      disabled={!state.canEdit || index === state.items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('bookmarks.edit')}: ${bookmark.name}`}
                      disabled={!state.canEdit}
                      onClick={() =>
                        setEditor({ bookmark, items: state.items, revision: state.revision })
                      }
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('bookmarks.delete')}: ${bookmark.name}`}
                      disabled={!state.canEdit}
                      onClick={() =>
                        setDeleting({ bookmark, items: state.items, revision: state.revision })
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.isConflicted && (
        <Alert variant="destructive">
          <AlertDescription>{t('bookmarks.conflict')}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!state.canSave || Boolean(editor) || Boolean(deleting)}
          onClick={() => void state.save()}
        >
          {state.isSaving && <Spinner data-icon="inline-start" />}
          {t(state.isSaving ? 'bookmarks.saving' : 'bookmarks.save')}
        </Button>
        {state.isDirty && (
          <Button variant="outline" disabled={state.isSaving} onClick={state.reset}>
            {t('bookmarks.reset')}
          </Button>
        )}
        <span role="status" className="text-sm text-muted-foreground">
          {state.isSaved ? t('bookmarks.saved') : state.isDirty ? t('bookmarks.unsaved') : ''}
        </span>
      </div>
      {editor && (
        <BookmarkEditor
          bookmark={editor.bookmark}
          isDisabled={!state.canEdit}
          onClose={() => setEditor(null)}
          onApply={(bookmark) => {
            if (!state.canEdit) return
            state.replace(
              editor.bookmark
                ? editor.items.map((item) => (item.id === bookmark.id ? bookmark : item))
                : [...editor.items, bookmark],
              editor.revision,
            )
            setEditor(null)
          }}
        />
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bookmarks.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.bookmark.name} — {t('bookmarks.deleteHelp')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!state.canEdit}
              onClick={() => {
                if (deleting)
                  state.replace(
                    deleting.items.filter((item) => item.id !== deleting.bookmark.id),
                    deleting.revision,
                  )
                setDeleting(null)
              }}
            >
              {t('bookmarks.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
