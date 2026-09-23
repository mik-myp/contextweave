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

export type AppDataContextValue = {
  environments: EnvironmentSummary[]
  proxies: ProxySummary[]
  kernels: KernelSummary[]
  appInfo?: AppInfo
  paths?: AppPaths
  selectedEnvironment?: string
  setSelectedEnvironment: (id: string | undefined) => void
  notice?: Notice
  setNotice: (notice: Notice | undefined) => void
  loading: boolean
  refresh: () => Promise<void>
  perform: (action: EnvironmentAction, success: string) => Promise<void>
  lastWorkerResult?: string
  setLastWorkerResult: (result: string | undefined) => void
}

export const AppDataContext = React.createContext<AppDataContextValue | null>(null)
