import { useQuery } from '@tanstack/react-query'
import { unwrapIpc } from '@/shared/lib/ipc'

export const localWorkspaceKey = ['app', 'workspace', 'current'] as const
export function useWorkspace() {
  return useQuery({
    queryKey: localWorkspaceKey,
    queryFn: async ({ signal }) => {
      const identity = await unwrapIpc(window.contextweave.workspace.current())
      signal.throwIfAborted()
      return identity
    },
    staleTime: Infinity,
    retry: false,
  })
}
