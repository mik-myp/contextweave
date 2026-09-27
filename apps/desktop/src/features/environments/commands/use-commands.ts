import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { unwrapIpc } from '@/shared/lib/ipc'
export function useCommandTracking() {
  const { commands } = useWorkspaceSession()
  return {
    client: commands,
    ...useSyncExternalStore(commands.subscribe, commands.getSnapshot, commands.getSnapshot),
  }
}
export function useActiveCommands() {
  const { context, api } = useWorkspaceSession()
  return useQuery({
    queryKey: workspaceKey(context, 'commands', 'active'),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const result = await unwrapIpc(api.environment.activeCommands())
      signal.throwIfAborted()
      return result
    },
    refetchInterval: (query) => (query.state.data?.items.length ? 1000 : false),
  })
}
