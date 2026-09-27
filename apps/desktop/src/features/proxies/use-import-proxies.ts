import { workspaceApi } from '@/features/workspaces/workspace-api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ImportProxiesInput } from '@contextweave/contracts'
import { unwrapIpc } from '@/shared/lib/ipc'

export function useImportProxies() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ImportProxiesInput) => unwrapIpc(workspaceApi.proxy.import(input)),
    onSettled: () => client.invalidateQueries({ queryKey: ['local', 'proxies'] }),
  })
}
