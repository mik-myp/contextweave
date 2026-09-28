import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultBookmarkListSchema,
  type Bookmark,
  type WorkspaceContext,
} from '@contextweave/contracts'
import {
  useWorkspaceApi,
  useWorkspaceContext,
  workspaceKey,
} from '@/features/workspaces/workspace-session-context'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'

export const defaultBookmarksKey = (context: WorkspaceContext) =>
  workspaceKey(context, 'bookmarks', 'defaults')

export function useDefaultBookmarks() {
  const context = useWorkspaceContext()
  const api = useWorkspaceApi()
  const client = useQueryClient()
  const key = defaultBookmarksKey(context)
  const [draft, setDraft] = useState<{ items: Bookmark[]; revision: number } | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [isSaved, setSaved] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef({ generation: 0, busy: false })
  useEffect(
    () => () => {
      request.current.generation++
    },
    [],
  )
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const value = await unwrapIpc(api.bookmarks.get())
      signal.throwIfAborted()
      return value
    },
    retry: false,
  })
  const data = query.error ? undefined : query.data
  const isConflicted = Boolean(draft && data && draft.revision !== data.revision)
  const canEdit = Boolean(data && !isSaving && !isConflicted && !query.isFetching)
  const canSave = Boolean(draft && canEdit)
  return {
    query,
    showErrors,
    validation: defaultBookmarkListSchema.safeParse(draft?.items ?? data?.items ?? []),
    error,
    isSaving,
    isSaved,
    canEdit,
    canSave,
    isConflicted,
    isDirty: draft !== null,
    revision: draft?.revision ?? data?.revision ?? 0,
    items: draft?.items ?? data?.items ?? [],
    replace(items: Bookmark[], revision = draft?.revision ?? data?.revision) {
      if (!canEdit || request.current.busy || !data) return
      setDraft({
        items,
        revision: revision ?? data.revision,
      })
      setSaved(false)
      setError(null)
    },
    reset() {
      if (request.current.busy) return
      setDraft(null)
      setShowErrors(false)
      setSaved(false)
      setError(null)
    },
    async save() {
      if (!canSave || !draft || request.current.busy) return
      const parsed = defaultBookmarkListSchema.safeParse(draft.items)
      setShowErrors(true)
      if (!parsed.success) return false
      request.current.busy = true
      const generation = ++request.current.generation
      setSaving(true)
      setSaved(false)
      setError(null)
      try {
        const value = await unwrapIpc(
          api.bookmarks.save({ expectedRevision: draft.revision, items: parsed.data }),
        )
        if (generation !== request.current.generation) return
        await client.cancelQueries({ queryKey: key, exact: true })
        if (generation !== request.current.generation) return
        client.setQueryData(key, value)
        setDraft(null)
        setSaved(true)
        setShowErrors(false)
        return true
      } catch (failure) {
        if (generation === request.current.generation) {
          setError(failure instanceof Error ? failure.message : errorMessage('COMMAND_FAILED'))
          // Refresh the revision without discarding unsaved edits. A conflict requires reset.
          void client.invalidateQueries({ queryKey: key, exact: true })
        }
      } finally {
        if (generation === request.current.generation) {
          request.current.busy = false
          setSaving(false)
        }
      }
    },
  }
}
