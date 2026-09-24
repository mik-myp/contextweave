import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrapIpc } from '@/shared/lib/ipc'
const key = ['local', 'proxies', 'credential-cleanup'] as const
export function useCredentialCleanup() {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: key,
    queryFn: () => unwrapIpc(window.contextweave.proxy.cleanupStatus()),
  })
  const retry = useMutation({
    mutationFn: () => unwrapIpc(window.contextweave.proxy.retryCleanup()),
    onSuccess: (result) => client.setQueryData(key, result),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
  return { status, retry }
}
