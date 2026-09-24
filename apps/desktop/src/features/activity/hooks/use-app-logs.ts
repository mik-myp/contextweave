import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrapIpc } from '@/shared/lib/ipc'

const logKey = ['local', 'app-logs'] as const

export function useAppLogs(autoRefresh: boolean) {
  const client = useQueryClient()
  const clear = useMutation({
    mutationFn: () => unwrapIpc(window.contextweave.logs.clear()),
    onMutate: () => client.cancelQueries({ queryKey: logKey }),
    onSuccess: (snapshot) => client.setQueryData(logKey, snapshot),
  })
  const query = useQuery({
    queryKey: logKey,
    queryFn: () => unwrapIpc(window.contextweave.logs.list()),
    enabled: !clear.isPending,
    refetchInterval: autoRefresh ? 3000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: autoRefresh,
    retry: false,
  })
  return { query, clear }
}
