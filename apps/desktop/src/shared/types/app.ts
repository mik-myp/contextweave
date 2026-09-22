import type { EnvironmentSummary } from '@contextweave/contracts'

export type KernelSummary = Extract<
  Awaited<ReturnType<typeof window.contextweave.kernel.list>>,
  { ok: true }
>['data'][number]

export type ProxySummary = Extract<
  Awaited<ReturnType<typeof window.contextweave.proxy.list>>,
  { ok: true }
>['data'][number]

export type AppInfo = {
  name: string
  version: string
  platform: string
  arch: string
  secureStorageAvailable: boolean
}

export type AppPaths = {
  userData: string
  dataRoot: string
  environmentRoot: string
  kernelRoot: string
  logRoot: string
}

export type Notice = { kind: 'success' | 'error'; message: string }

export type EnvironmentAction = () => Promise<
  { ok: true; data: EnvironmentSummary } | { ok: false; message: string }
>
