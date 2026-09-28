import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  isBatchActive,
  type BatchAction,
  type BatchPreview,
  type IpcResult,
  type BatchPage,
  type BatchTask,
} from '@contextweave/contracts'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
export type BatchRequest =
  { action: BatchAction; environmentIds: string[] } | { retryTaskId: string }
export function useBatchPreview(request: BatchRequest) {
  const { api } = useWorkspaceSession()
  // Snapshot the dialog's selected IDs. It is not a live table selector.
  const [source] = useState<BatchRequest>(() =>
    'retryTaskId' in request
      ? { retryTaskId: request.retryTaskId }
      : { action: request.action, environmentIds: [...request.environmentIds] },
  )
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{
    api?: typeof api
    generation: number
    data?: BatchPreview
    error?: string
  }>({ generation: -1 })
  const pending = useRef<
    { api: typeof api; generation: number; promise: Promise<BatchPreview> } | undefined
  >(undefined)
  useEffect(() => {
    let mounted = true
    // StrictMode can remount effects; reuse this dialog's request rather than
    // allocate another Main preview. Only an explicit retry creates a new one.
    if (
      !pending.current ||
      pending.current.api !== api ||
      pending.current.generation !== generation
    )
      pending.current = {
        api,
        generation,
        promise: unwrapIpc(
          'retryTaskId' in source
            ? api.batch.retryPreview(source.retryTaskId)
            : api.batch.preview(source),
        ),
      }
    void pending.current.promise.then(
      (data) => {
        if (mounted) setState({ api, generation, data })
      },
      (cause) => {
        if (mounted)
          setState({
            api,
            generation,
            error: cause instanceof Error ? cause.message : errorMessage('COMMAND_FAILED'),
          })
      },
    )
    return () => {
      mounted = false
    }
  }, [api, source, generation])
  const current = state.api === api && state.generation === generation
  return {
    loading: !current,
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    reload: () => setGeneration((value) => value + 1),
  }
}
export function useBatchPage(beforeId: string | null) {
  const { api, context } = useWorkspaceSession()
  return useQuery<BatchPage>({
    queryKey: workspaceKey(context, 'batches', 'page', beforeId),
    refetchInterval: (query) =>
      query.state.data?.items.some((task) => isBatchActive(task.status)) ? 1000 : false,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const page = await unwrapIpc(api.batch.page({ beforeId, limit: 20 }))
      signal.throwIfAborted()
      return page
    },
  })
}
export function useBatchTask(id: string) {
  const { api, context } = useWorkspaceSession()
  return useQuery<BatchTask>({
    queryKey: workspaceKey(context, 'batches', 'detail', id),
    refetchInterval: (query) =>
      query.state.data && isBatchActive(query.state.data.status) ? 1000 : false,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const task = await unwrapIpc(api.batch.get(id))
      signal.throwIfAborted()
      return task
    },
  })
}
export function useBatchCommand() {
  const { context } = useWorkspaceSession(),
    client = useQueryClient()
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>()
  const active = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return {
    pending,
    error,
    clearError: () => setError(undefined),
    async run<T>(action: () => Promise<IpcResult<T>>, onSuccess?: (value: T) => void) {
      if (active.current) return
      active.current = true
      setPending(true)
      setError(undefined)
      try {
        const value = await unwrapIpc(action())
        void client.invalidateQueries({ queryKey: workspaceKey(context, 'batches') })
        if (mounted.current) onSuccess?.(value)
      } catch (cause) {
        if (mounted.current)
          setError(cause instanceof Error ? cause.message : errorMessage('COMMAND_FAILED'))
      } finally {
        active.current = false
        if (mounted.current) setPending(false)
      }
    },
  }
}
