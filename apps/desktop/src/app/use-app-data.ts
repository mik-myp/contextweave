import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EnvironmentSummary } from '@contextweave/contracts'
import type { EnvironmentAction } from '@/shared/types/app'
import { unwrapIpc } from '@/shared/lib/ipc'
import { AppDataContext } from './app-data-context'
export type AppDomain = 'environments' | 'proxies' | 'kernels' | 'activity' | 'app'
const noDomains: readonly AppDomain[] = []

/** Queries are enabled by their consuming page; this hook does not poll other domains. */
export function useAppData(domains: readonly AppDomain[] = noDomains) {
  const context = React.useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used within AppDataProvider')
  const client = useQueryClient()
  const environments = useQuery({
    queryKey: ['local', 'environments', 'list'],
    queryFn: () => unwrapIpc(window.contextweave.environment.list()),
    enabled: domains.includes('environments'),
  })
  const proxies = useQuery({
    queryKey: ['local', 'proxies'],
    queryFn: () => unwrapIpc(window.contextweave.proxy.list()),
    enabled: domains.includes('proxies'),
  })
  const kernels = useQuery({
    queryKey: ['local', 'kernels'],
    queryFn: () => unwrapIpc(window.contextweave.kernel.list()),
    enabled: domains.includes('kernels'),
  })
  const activity = useQuery({
    queryKey: ['local', 'activity'],
    queryFn: () => unwrapIpc(window.contextweave.activity.list()),
    enabled: domains.includes('activity'),
  })
  const appInfo = useQuery({
    queryKey: ['local', 'app', 'info'],
    queryFn: () => unwrapIpc(window.contextweave.app.getInfo()),
    enabled: domains.includes('app'),
    staleTime: Infinity,
  })
  const paths = useQuery({
    queryKey: ['local', 'app', 'paths'],
    queryFn: () => unwrapIpc(window.contextweave.app.getPaths()),
    enabled: domains.includes('app'),
    staleTime: Infinity,
  })
  const domainKey = domains.join(',')
  const refresh = React.useCallback(async () => {
    const selected = domainKey ? domainKey.split(',') : []
    if (!selected.length) {
      await client.invalidateQueries({ queryKey: ['local'], refetchType: 'active' })
      return
    }
    await Promise.all(
      selected.map((domain) => client.invalidateQueries({ queryKey: ['local', domain] })),
    )
  }, [client, domainKey])
  const upsertEnvironment = React.useCallback(
    (environment: EnvironmentSummary) => {
      void client.cancelQueries({ queryKey: ['local', 'environments'] })
      client.setQueryData<EnvironmentSummary[]>(
        ['local', 'environments', 'list'],
        (current = []) =>
          current.some((item) => item.id === environment.id)
            ? current.map((item) => (item.id === environment.id ? environment : item))
            : [environment, ...current],
      )
    },
    [client],
  )
  const { setNotice } = context
  const perform = React.useCallback(
    async (action: EnvironmentAction, success: string) => {
      const result = await action()
      setNotice(
        result.ok
          ? { kind: 'success', message: success }
          : { kind: 'error', message: result.message },
      )
      if (result.ok) await refresh()
    },
    [refresh, setNotice],
  )
  const queries = { environments, proxies, kernels, activity, app: appInfo }
  return {
    ...context,
    environments: environments.data ?? [],
    proxies: proxies.data ?? [],
    kernels: kernels.data ?? [],
    activity: activity.data ?? [],
    appInfo: appInfo.data,
    paths: paths.data,
    loading: domains.some((domain) => queries[domain].isPending),
    error: environments.error?.message,
    proxyError: proxies.error?.message,
    kernelError: kernels.error?.message,
    activityError: activity.error?.message,
    appError: appInfo.error?.message ?? paths.error?.message,
    configurationError: kernels.error?.message ?? proxies.error?.message,
    refresh,
    upsertEnvironment,
    perform,
  }
}
