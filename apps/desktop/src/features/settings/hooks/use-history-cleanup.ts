import { workspaceKey, useWorkspaceContext } from '@/features/workspaces/workspace-session-context'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type HistoryCleanupPreview,
  type HistoryCleanupResult,
  type HistoryCleanupRetentionDays,
} from '@contextweave/contracts'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'

export function useHistoryCleanup() {
  const workspaceContext = useWorkspaceContext()
  const workspaceApi = useWorkspaceApi()
  const receiptKey = workspaceKey(workspaceContext, 'storage', 'history-cleanup-receipt')
  const client = useQueryClient()
  const [retentionDays, setRetentionDays] = useState<HistoryCleanupRetentionDays>(90)
  const [preview, setPreview] = useState<HistoryCleanupPreview | null>(null)
  const [result, setResult] = useState<HistoryCleanupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uncertainId, setUncertainId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'confirming' | 'reconciling'>('idle')
  const request = useRef({ generation: 0, busy: false })
  useEffect(
    () => () => {
      request.current.generation++
    },
    [],
  )
  const receipt = useQuery({
    queryKey: receiptKey,
    queryFn: async ({ signal }) => {
      const value = await unwrapIpc(workspaceApi.storage.getHistoryCleanupReceipt())
      signal.throwIfAborted()
      return value
    },
  })
  const invalidate = () => {
    for (const domain of ['activity', 'operations', 'storage'])
      void client.invalidateQueries({ queryKey: workspaceKey(workspaceContext, domain) })
  }
  const accept = (value: HistoryCleanupResult) => {
    setResult(value)
    setPreview(null)
    setUncertainId(null)
    setError(null)
    void client.cancelQueries({ queryKey: receiptKey, exact: true })
    client.setQueryData(receiptKey, value.receipt)
    invalidate()
  }
  const begin = (next: typeof phase) => {
    if (request.current.busy) return null
    request.current.busy = true
    const generation = ++request.current.generation
    setPhase(next)
    setError(null)
    return generation
  }
  const finish = (generation: number) => {
    if (generation === request.current.generation) {
      request.current.busy = false
      setPhase('idle')
    }
  }
  const discard = () => {
    if (request.current.busy && phase !== 'previewing') return
    request.current.generation++
    request.current.busy = false
    setPhase('idle')
    setPreview(null)
    setDialogOpen(false)
    setUncertainId(null)
    setError(null)
  }
  return {
    retentionDays,
    preview,
    result,
    error,
    uncertainId,
    dialogOpen,
    phase,
    receipt,
    setRetentionDays: (days: HistoryCleanupRetentionDays) => {
      if (request.current.busy || uncertainId) return
      discard()
      setResult(null)
      setRetentionDays(days)
    },
    setDialogOpen: (open: boolean) => {
      if (!request.current.busy) setDialogOpen(open)
    },
    discard,
    async loadPreview() {
      if (uncertainId) return
      const generation = begin('previewing')
      if (generation === null) return
      setPreview(null)
      setResult(null)
      try {
        const value = await unwrapIpc(workspaceApi.storage.previewHistoryCleanup({ retentionDays }))
        if (generation === request.current.generation) setPreview(value)
      } catch (error) {
        if (generation === request.current.generation)
          setError(error instanceof Error ? error.message : errorMessage('COMMAND_FAILED'))
      } finally {
        finish(generation)
      }
    },
    async confirm() {
      if (!preview || !dialogOpen) return
      const generation = begin('confirming')
      if (generation === null) return
      try {
        const response = await workspaceApi.storage.confirmHistoryCleanup({
          previewId: preview.previewId,
        })
        if (generation !== request.current.generation) return
        if (response.ok) accept(response.data)
        else {
          setError(errorMessage(response.code))
          if (
            [
              'HISTORY_CLEANUP_PREVIEW_INVALID',
              'HISTORY_CLEANUP_PREVIEW_EXPIRED',
              'HISTORY_CLEANUP_EMPTY',
            ].includes(response.code)
          ) {
            setPreview(null)
            setUncertainId(null)
          } else setUncertainId(preview.previewId)
        }
      } catch {
        if (generation === request.current.generation) {
          setError(errorMessage('IPC_UNAVAILABLE'))
          setUncertainId(preview.previewId)
        }
      } finally {
        if (generation === request.current.generation) setDialogOpen(false)
        finish(generation)
      }
    },
    async reconcile() {
      const generation = begin('reconciling')
      if (generation === null) return
      try {
        const value = await unwrapIpc(workspaceApi.storage.getHistoryCleanupReceipt())
        if (generation !== request.current.generation) return
        client.setQueryData(receiptKey, value)
        if (value && value.previewId === uncertainId) accept({ receipt: value, replayed: true })
      } catch (error) {
        if (generation === request.current.generation)
          setError(error instanceof Error ? error.message : errorMessage('COMMAND_FAILED'))
      } finally {
        finish(generation)
      }
    },
  }
}
