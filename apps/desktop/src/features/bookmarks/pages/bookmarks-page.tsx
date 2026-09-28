import { useState } from 'react'
import { GripVerticalIcon, PlusIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { maxDefaultBookmarks, type Bookmark } from '@contextweave/contracts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from '@/components/ui/sortable'
import { useI18n } from '@/i18n'
import { useDefaultBookmarks } from '../hooks/use-default-bookmarks'

const getItemValue = (item: Bookmark) => item.id
export function BookmarksPage() {
  const { t } = useI18n()
  const state = useDefaultBookmarks()
  const [removed, setRemoved] = useState<{ item: Bookmark; index: number } | null>(null)
  const invalid = (index: number, field: string) =>
    state.showErrors &&
    !state.validation.success &&
    state.validation.error.issues.some(
      (issue) => issue.path[0] === index && issue.path[1] === field,
    )
  const change = (id: string, patch: Partial<Bookmark>) =>
    state.replace(state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      aria-label={t('bookmarks.title')}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('bookmarks.list')}</span>
          <Badge variant="secondary">
            {state.items.length} / {maxDefaultBookmarks}
          </Badge>
          <span role="status" className="text-xs text-muted-foreground">
            {state.isSaved ? t('bookmarks.saved') : state.isDirty ? t('bookmarks.unsaved') : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!state.canEdit || state.items.length >= maxDefaultBookmarks}
            onClick={() =>
              state.replace([
                ...state.items,
                { id: crypto.randomUUID(), name: '', url: '', openOnStart: false },
              ])
            }
          >
            <PlusIcon data-icon="inline-start" />
            {t('bookmarks.add')}
          </Button>
          {state.isDirty && (
            <Button
              variant="outline"
              size="sm"
              disabled={state.isSaving}
              onClick={() => {
                state.reset()
                setRemoved(null)
              }}
            >
              {t('bookmarks.reset')}
            </Button>
          )}
          <Button
            size="sm"
            disabled={!state.canSave}
            onClick={() =>
              void state.save().then((saved) => {
                if (saved) setRemoved(null)
              })
            }
          >
            {state.isSaving && <Spinner data-icon="inline-start" />}
            {t(state.isSaving ? 'bookmarks.saving' : 'bookmarks.save')}
          </Button>
        </div>
      </div>
      {(state.error || state.isConflicted) && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.isConflicted ? t('bookmarks.conflict') : state.error}
          </AlertDescription>
        </Alert>
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border p-3">
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
        ) : !state.items.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('bookmarks.empty')}</EmptyTitle>
              <EmptyDescription>{t('bookmarks.emptyHelp')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Sortable
            value={state.items}
            onValueChange={(items) => state.replace(items)}
            getItemValue={getItemValue}
            orientation="vertical"
            accessibility={{
              screenReaderInstructions: { draggable: t('bookmarks.dragHelp') },
              announcements: {
                onDragStart: () => t('bookmarks.dragging'),
                onDragOver: ({ over }) =>
                  over
                    ? t('bookmarks.dragPosition').replace(
                        '{position}',
                        String(state.items.findIndex((item) => item.id === over.id) + 1),
                      )
                    : undefined,
                onDragEnd: () => t('bookmarks.dragged'),
                onDragCancel: () => t('bookmarks.dragCancelled'),
              },
            }}
          >
            <SortableContent
              render={<ol aria-label={t('bookmarks.list')} />}
              className="flex flex-col gap-3"
            >
              {state.items.map((bookmark, index) => (
                <SortableItem
                  key={bookmark.id}
                  value={bookmark.id}
                  render={<li />}
                  disabled={!state.canEdit}
                  className="grid min-w-0 grid-cols-[auto_minmax(8rem,1fr)_minmax(12rem,2fr)_auto_auto] items-start gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  <SortableItemHandle
                    render={<Button size="icon-sm" variant="ghost" />}
                    className="h-(--control-height) touch-none"
                    aria-label={`${t('bookmarks.drag')}: ${bookmark.name || index + 1}`}
                  >
                    <GripVerticalIcon />
                  </SortableItemHandle>
                  <Field className="min-w-0" data-invalid={invalid(index, 'name')}>
                    <FieldLabel className="sr-only" htmlFor={`${bookmark.id}-name`}>
                      {t('bookmarks.name')} {index + 1}
                    </FieldLabel>
                    <Input
                      id={`${bookmark.id}-name`}
                      value={bookmark.name}
                      maxLength={120}
                      placeholder={t('bookmarks.name')}
                      disabled={!state.canEdit}
                      aria-invalid={invalid(index, 'name')}
                      onChange={(event) => change(bookmark.id, { name: event.target.value })}
                    />
                    {invalid(index, 'name') && (
                      <FieldError>{t('bookmarks.invalidName')}</FieldError>
                    )}
                  </Field>
                  <Field className="min-w-0" data-invalid={invalid(index, 'url')}>
                    <FieldLabel className="sr-only" htmlFor={`${bookmark.id}-url`}>
                      {t('bookmarks.url')} {index + 1}
                    </FieldLabel>
                    <Input
                      id={`${bookmark.id}-url`}
                      type="url"
                      dir="ltr"
                      value={bookmark.url}
                      maxLength={4096}
                      placeholder="https://..."
                      disabled={!state.canEdit}
                      aria-invalid={invalid(index, 'url')}
                      onChange={(event) => change(bookmark.id, { url: event.target.value })}
                    />
                    {invalid(index, 'url') && <FieldError>{t('bookmarks.urlHelp')}</FieldError>}
                  </Field>
                  <Field
                    orientation="horizontal"
                    className="h-(--control-height) w-auto items-center"
                  >
                    <Checkbox
                      id={`${bookmark.id}-startup`}
                      checked={bookmark.openOnStart === true}
                      disabled={!state.canEdit}
                      onCheckedChange={(checked) =>
                        change(bookmark.id, { openOnStart: checked === true })
                      }
                    />
                    <FieldLabel htmlFor={`${bookmark.id}-startup`}>
                      {t('bookmarks.openOnStart')}
                    </FieldLabel>
                  </Field>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-(--control-height)"
                    aria-label={`${t('bookmarks.delete')}: ${bookmark.name || index + 1}`}
                    disabled={!state.canEdit}
                    onClick={() => {
                      setRemoved({ item: bookmark, index })
                      state.replace(state.items.filter((item) => item.id !== bookmark.id))
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </SortableItem>
              ))}
            </SortableContent>
          </Sortable>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        {removed && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!state.canEdit || state.items.length >= maxDefaultBookmarks}
            onClick={() => {
              const items = [...state.items]
              items.splice(Math.min(removed.index, items.length), 0, removed.item)
              state.replace(items)
              setRemoved(null)
            }}
          >
            <Undo2Icon data-icon="inline-start" />
            {t('bookmarks.undoDelete')}
          </Button>
        )}
      </div>
    </section>
  )
}
