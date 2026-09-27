import { workspaceKey, useWorkspaceContext } from '@/features/workspaces/workspace-session-context'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrapIpc } from '@/shared/lib/ipc'
export function useCredentialCleanup() {
  const workspaceContext = useWorkspaceContext()
  const workspaceApi = useWorkspaceApi()
  const key = workspaceKey(workspaceContext, 'proxies', 'credential-cleanup')
  const client = useQueryClient()
  const status = useQuery({
    queryKey: key,
    queryFn: () => unwrapIpc(workspaceApi.proxy.cleanupStatus()),
  })
  const retry = useMutation({
    mutationFn: () => unwrapIpc(workspaceApi.proxy.retryCleanup()),
    onSuccess: (result) => client.setQueryData(key, result),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
  return { status, retry }
}
