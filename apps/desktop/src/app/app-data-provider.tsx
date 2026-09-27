import { useWorkspace } from '@/features/workspaces/hooks/use-workspace'
import { WorkspaceSessionProvider } from '@/features/workspaces/workspace-session-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
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
  return (
    <QueryClientProvider client={client}>
      <Bootstrap>{children}</Bootstrap>
    </QueryClientProvider>
  )
}
function Bootstrap({ children }: { children: React.ReactNode }) {
  const identity = useWorkspace()
  const { t } = useI18n()
  if (identity.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('workspace.unavailable')}</AlertTitle>
        <AlertDescription>{identity.error.message}</AlertDescription>
        <Button onClick={() => void identity.refetch()}>{t('common.retry')}</Button>
      </Alert>
    )
  if (!identity.data) return <p role="status">{t('workspace.loading')}</p>
  const context = { workspaceId: identity.data.workspaceId }
  return (
    <WorkspaceSessionProvider context={context} legacyDraftOwner={context.workspaceId}>
      <SessionState>{children}</SessionState>
    </WorkspaceSessionProvider>
  )
}
function SessionState({ children }: { children: React.ReactNode }) {
  const [selectedEnvironment, setSelectedEnvironment] = React.useState<string>()
  const [notice, setNotice] = React.useState<Notice>()
  const [lastWorkerResult, setLastWorkerResult] = React.useState<string>()
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
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
