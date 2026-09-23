import * as React from 'react'
import type { EnvironmentSummary } from '@contextweave/contracts'
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
  const [proxies, setProxies] = React.useState<ProxySummary[]>([])
  const [kernels, setKernels] = React.useState<KernelSummary[]>([])
  const [appInfo, setAppInfo] = React.useState<AppInfo>()
  const [paths, setPaths] = React.useState<AppPaths>()
  const [selectedEnvironment, setSelectedEnvironment] = React.useState<string>()
  const [notice, setNotice] = React.useState<Notice>()
  const [loading, setLoading] = React.useState(false)
  const [lastWorkerResult, setLastWorkerResult] = React.useState<string>()

  const refresh = React.useCallback(async () => {
    setLoading(true)
    const [environmentCall, proxyCall, kernelCall, infoCall, pathCall] = await Promise.allSettled([
      window.contextweave.environment.list(),
      window.contextweave.proxy.list(),
      window.contextweave.kernel.list(),
      window.contextweave.app.getInfo(),
      window.contextweave.app.getPaths(),
    ])
    const calls = [environmentCall, proxyCall, kernelCall, infoCall, pathCall]
    const rejected = calls.find((call) => call.status === 'rejected')
    if (rejected?.status === 'rejected') {
      setNotice({
        kind: 'error',
        message: rejected.reason instanceof Error ? rejected.reason.message : '本地运行时读取失败',
      })
    }
    if (
      environmentCall.status !== 'fulfilled' ||
      proxyCall.status !== 'fulfilled' ||
      kernelCall.status !== 'fulfilled' ||
      infoCall.status !== 'fulfilled' ||
      pathCall.status !== 'fulfilled'
    ) {
      setLoading(false)
      return
    }
    const environmentResult = environmentCall.value
    const proxyResult = proxyCall.value
    const kernelResult = kernelCall.value
    const infoResult = infoCall.value
    const pathResult = pathCall.value
    const failed = [environmentResult, proxyResult, kernelResult, infoResult, pathResult].find(
      (result) => !result.ok,
    )
    if (failed && !failed.ok) setNotice({ kind: 'error', message: failed.message })
    if (environmentResult.ok) {
      setEnvironments(environmentResult.data)
      setSelectedEnvironment((current) =>
        current && environmentResult.data.some((item) => item.id === current)
          ? current
          : environmentResult.data[0]?.id,
      )
    }
    if (proxyResult.ok) setProxies([...proxyResult.data])
    if (kernelResult.ok) setKernels([...kernelResult.data])
    if (infoResult.ok) setAppInfo(infoResult.data)
    if (pathResult.ok) setPaths(pathResult.data)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

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
      proxies,
      kernels,
      appInfo,
      paths,
      selectedEnvironment,
      setSelectedEnvironment,
      notice,
      setNotice,
      loading,
      refresh,
      perform,
      lastWorkerResult,
      setLastWorkerResult,
    }),
    [
      environments,
      proxies,
      kernels,
      appInfo,
      paths,
      selectedEnvironment,
      notice,
      loading,
      refresh,
      perform,
      lastWorkerResult,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
