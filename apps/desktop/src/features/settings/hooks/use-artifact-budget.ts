import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { artifactBudgetUpdateSchema } from '@contextweave/contracts'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'

export const artifactBudgetKey = ['local', 'storage', 'artifact-budget'] as const
export function useArtifactBudget() {
  const client = useQueryClient()
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [isSaved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef({ generation: 0, busy: false })
  useEffect(
    () => () => {
      request.current.generation++
    },
    [],
  )
  const query = useQuery({
    queryKey: artifactBudgetKey,
    queryFn: async ({ signal }) => {
      const value = await unwrapIpc(window.contextweave.storage.getArtifactBudget())
      signal.throwIfAborted()
      return value
    },
    retry: false,
  })
  const data = query.error ? undefined : query.data
  const text = draft?.text ?? (data ? String(data.limitMiB) : '')
  const parsed = artifactBudgetUpdateSchema.safeParse({
    limitMiB: /^[0-9]+$/.test(text) ? Number(text) : NaN,
    expectedRevision: draft?.revision ?? data?.revision,
  })
  const isConflicted = Boolean(draft && data && draft.revision !== data.revision)
  const canSave = Boolean(
    draft && data && parsed.success && !isConflicted && !isSaving && !query.isFetching,
  )
  return {
    query,
    data,
    text,
    isSaving,
    isSaved,
    error,
    isConflicted,
    canSave,
    isInvalid: Boolean(draft && !parsed.success),
    isDirty: draft !== null,
    edit(value: string) {
      if (request.current.busy || !data) return
      setDraft({ text: value, revision: draft?.revision ?? data.revision })
      setSaved(false)
      setError(null)
    },
    reset() {
      if (request.current.busy) return
      setDraft(null)
      setError(null)
      setSaved(false)
    },
    async save() {
      if (request.current.busy || !canSave || !parsed.success) return
      request.current.busy = true
      const generation = ++request.current.generation
      setSaving(true)
      setError(null)
      setSaved(false)
      try {
        const value = await unwrapIpc(window.contextweave.storage.updateArtifactBudget(parsed.data))
        if (generation !== request.current.generation) return
        await client.cancelQueries({ queryKey: artifactBudgetKey, exact: true })
        if (generation !== request.current.generation) return
        client.setQueryData(artifactBudgetKey, value)
        setDraft(null)
        setSaved(true)
        void client.invalidateQueries({ queryKey: ['local', 'storage'] })
      } catch (failure) {
        if (generation === request.current.generation)
          setError(failure instanceof Error ? failure.message : errorMessage('COMMAND_FAILED'))
      } finally {
        if (generation === request.current.generation) {
          request.current.busy = false
          setSaving(false)
        }
      }
    },
  }
}
