import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Notice } from '@/shared/types/app'
import { AppDataContext } from './app-data-context'
export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: false, networkMode: 'always' },
          mutations: { retry: false, networkMode: 'always' },
        },
      }),
  )
  const [selectedEnvironment, setSelectedEnvironment] = React.useState<string>()
  const [notice, setNotice] = React.useState<Notice>()
  const [lastWorkerResult, setLastWorkerResult] = React.useState<string>()
  React.useEffect(() => {
    const unsubscribe = window.contextweave.events.onDataChanged((domains) => {
      for (const domain of domains) void client.invalidateQueries({ queryKey: ['local', domain] })
    })
    // Events only invalidate snapshots. Focus reconciles active pages after a missed event.
    const reconcile = () => {
      void client.invalidateQueries({ queryKey: ['local'], refetchType: 'active' })
    }
    window.addEventListener('focus', reconcile)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', reconcile)
    }
  }, [client])
  const value = React.useMemo(
    () => ({
      selectedEnvironment,
      setSelectedEnvironment,
      notice,
      setNotice,
      lastWorkerResult,
      setLastWorkerResult,
    }),
    [selectedEnvironment, notice, lastWorkerResult],
  )
  return (
    <QueryClientProvider client={client}>
      <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
    </QueryClientProvider>
  )
}
