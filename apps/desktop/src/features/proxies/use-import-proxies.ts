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
    // A completed import must not leave plaintext request variables in an inactive cache.
    gcTime: 0,
    retry: false,
    mutationFn: (input: ImportProxiesInput) => unwrapIpc(workspaceApi.proxy.import(input)),
    onSettled: () =>
      client.invalidateQueries({ queryKey: workspaceKey(workspaceContext, 'proxies') }),
  })
}
