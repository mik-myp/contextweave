import { workspaceKey, useWorkspaceContext } from '@/features/workspaces/workspace-session-context'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ArtifactQuery } from '@contextweave/contracts'
import { unwrapIpc } from '@/shared/lib/ipc'

export function useArtifactInventory() {
  const workspaceContext = useWorkspaceContext()
  const workspaceApi = useWorkspaceApi()
  const [cursor, setCursor] = useState<ArtifactQuery['cursor']>(null)
  const query = useQuery({
    queryKey: workspaceKey(workspaceContext, 'storage', 'artifacts', cursor),
    queryFn: async ({ signal }) => {
      const result = await unwrapIpc(workspaceApi.storage.pageArtifacts({ limit: 20, cursor }))
      signal.throwIfAborted()
      return result
    },
    retry: false,
  })
  return { query, cursor, setCursor }
}
