import * as React from 'react'
import type { ActivitySummary, EnvironmentSummary } from '@contextweave/contracts'
import type {
  AppInfo,
  AppPaths,
  EnvironmentAction,
  KernelSummary,
  Notice,
  ProxySummary,
} from '@/shared/types/app'
import type { AppDataContextValue } from './app-data-context'
import { AppDataContext } from './app-data-context'

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [environments, setEnvironments] = React.useState<EnvironmentSummary[]>([])
  const [activity, setActivity] = React.useState<ActivitySummary[]>([])
  const [activityError, setActivityError] = React.useState<string>()
  const [proxyError, setProxyError] = React.useState<string>()
  const [kernelError, setKernelError] = React.useState<string>()
  const [appError, setAppError] = React.useState<string>()
  const [proxies, setProxies] = React.useState<ProxySummary[]>([])
  const [kernels, setKernels] = React.useState<KernelSummary[]>([])
  const [appInfo, setAppInfo] = React.useState<AppInfo>()
  const [paths, setPaths] = React.useState<AppPaths>()
  const [selectedEnvironment, setSelectedEnvironment] = React.useState<string>()
  const [notice, setNotice] = React.useState<Notice>()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string>()
  const [configurationError, setConfigurationError] = React.useState<string>()
  const loaded = React.useRef(false)
  const requestId = React.useRef(0)
  const [lastWorkerResult, setLastWorkerResult] = React.useState<string>()

  const refresh = React.useCallback(async () => {
    const currentRequest = ++requestId.current
    if (!loaded.current) setLoading(true)
    setError(undefined)
    const [environmentCall, proxyCall, kernelCall, infoCall, pathCall, activityCall] =
      await Promise.allSettled([
        window.contextweave.environment.list(),
        window.contextweave.proxy.list(),
        window.contextweave.kernel.list(),
        window.contextweave.app.getInfo(),
        window.contextweave.app.getPaths(),
        window.contextweave.activity.list(),
      ])
    if (currentRequest !== requestId.current) return
    const callError = (call: PromiseSettledResult<{ ok: boolean; message?: string }>) =>
      call.status === 'rejected'
        ? call.reason instanceof Error
          ? call.reason.message
          : '本地运行时读取失败'
        : !call.value.ok
          ? call.value.message
          : undefined
    setActivityError(callError(activityCall))
    setProxyError(callError(proxyCall))
    setKernelError(callError(kernelCall))
    setAppError(callError(infoCall) ?? callError(pathCall))
    if (activityCall.status === 'fulfilled' && activityCall.value.ok)
      setActivity(activityCall.value.data)
    const calls = [environmentCall]
    const rejected = calls.find((call) => call.status === 'rejected')
    const failed = calls.find((call) => call.status === 'fulfilled' && !call.value.ok)
    if (rejected?.status === 'rejected')
      setError(rejected.reason instanceof Error ? rejected.reason.message : '本地运行时读取失败')
    else if (failed?.status === 'fulfilled' && !failed.value.ok) setError(failed.value.message)
    const configurationCalls = [proxyCall, kernelCall]
    const configFailure = configurationCalls.find(
      (call) => call.status === 'rejected' || !call.value.ok,
    )
    setConfigurationError(
      configFailure?.status === 'rejected'
        ? configFailure.reason instanceof Error
          ? configFailure.reason.message
          : '无法读取代理或内核'
        : configFailure?.status === 'fulfilled' && !configFailure.value.ok
          ? configFailure.value.message
          : undefined,
    )
    const environmentResult =
      environmentCall.status === 'fulfilled' ? environmentCall.value : undefined
    const proxyResult = proxyCall.status === 'fulfilled' ? proxyCall.value : undefined
    const kernelResult = kernelCall.status === 'fulfilled' ? kernelCall.value : undefined
    const infoResult = infoCall.status === 'fulfilled' ? infoCall.value : undefined
    const pathResult = pathCall.status === 'fulfilled' ? pathCall.value : undefined
    if (environmentResult?.ok) {
      loaded.current = true
      setEnvironments(environmentResult.data)
      setSelectedEnvironment((current) =>
        current && environmentResult.data.some((item) => item.id === current)
          ? current
          : environmentResult.data[0]?.id,
      )
    }
    if (proxyResult?.ok) setProxies([...proxyResult.data])
    if (kernelResult?.ok) setKernels([...kernelResult.data])
    if (infoResult?.ok) setAppInfo(infoResult.data)
    if (pathResult?.ok) setPaths(pathResult.data)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const hasActiveEnvironment = environments.some((item) =>
    ['running', 'starting', 'stopping'].includes(item.status),
  )
  React.useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshVisible)
    const timer = hasActiveEnvironment ? window.setInterval(refreshVisible, 5000) : undefined
    return () => {
      window.removeEventListener('focus', refreshVisible)
      window.clearInterval(timer)
    }
  }, [hasActiveEnvironment, refresh])

  const upsertEnvironment = React.useCallback((environment: EnvironmentSummary) => {
    // Invalidate older reads so they cannot overwrite a successful mutation.
    requestId.current += 1
    setEnvironments((current) =>
      current.some((item) => item.id === environment.id)
        ? current.map((item) => (item.id === environment.id ? environment : item))
        : [environment, ...current],
    )
  }, [])

  const perform = React.useCallback(
    async (action: EnvironmentAction, success: string) => {
      const result = await action()
      if (result.ok) {
        setNotice({ kind: 'success', message: success })
        await refresh()
      } else setNotice({ kind: 'error', message: result.message })
    },
    [refresh],
  )

  const value = React.useMemo<AppDataContextValue>(
    () => ({
      environments,
      activity,
      activityError,
      proxyError,
      kernelError,
      appError,
      proxies,
      kernels,
      appInfo,
      paths,
      selectedEnvironment,
      setSelectedEnvironment,
      notice,
      setNotice,
      loading,
      error,
      configurationError,
      upsertEnvironment,
      refresh,
      perform,
      lastWorkerResult,
      setLastWorkerResult,
    }),
    [
      environments,
      activity,
      activityError,
      proxyError,
      kernelError,
      appError,
      proxies,
      kernels,
      appInfo,
      paths,
      selectedEnvironment,
      notice,
      loading,
      error,
      configurationError,
      upsertEnvironment,
      refresh,
      perform,
      lastWorkerResult,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
