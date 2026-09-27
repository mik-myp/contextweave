import { workspaceKey, useWorkspaceContext } from '@/features/workspaces/workspace-session-context'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ImportProxiesInput } from '@contextweave/contracts'
import { unwrapIpc } from '@/shared/lib/ipc'

export function useImportProxies() {
  const workspaceContext = useWorkspaceContext()
  const workspaceApi = useWorkspaceApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ImportProxiesInput) => unwrapIpc(workspaceApi.proxy.import(input)),
    onSettled: () =>
      client.invalidateQueries({ queryKey: workspaceKey(workspaceContext, 'proxies') }),
  })
}
