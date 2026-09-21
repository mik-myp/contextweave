import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateEnvironmentInput,
  IpcResult,
  EnvironmentSummary,
  SaveProxyInput,
  ThemeConfig,
} from '@contextweave/contracts'
import type { WorkerResult, WorkerTask } from '@contextweave/worker-protocol'

const api = {
  app: {
    getInfo: () =>
      ipcRenderer.invoke('app:get-info') as Promise<
        IpcResult<{
          name: string
          version: string
          platform: string
          arch: string
          secureStorageAvailable: boolean
        }>
      >,
    getPaths: () =>
      ipcRenderer.invoke('app:get-paths') as Promise<
        IpcResult<{
          userData: string
          dataRoot: string
          environmentRoot: string
          kernelRoot: string
          logRoot: string
        }>
      >,
    openExternal: (url: string) =>
      ipcRenderer.invoke('app:open-external', url) as Promise<IpcResult<boolean>>,
  },
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme') as Promise<IpcResult<ThemeConfig>>,
    setTheme: (theme: ThemeConfig) =>
      ipcRenderer.invoke('settings:set-theme', theme) as Promise<IpcResult<ThemeConfig>>,
  },
  kernel: {
    list: () =>
      ipcRenderer.invoke('kernel:list') as Promise<
        IpcResult<
          ReadonlyArray<{
            id: string
            label: string
            family: string
            platform: string
            arch: string
            version: string
            status: string
            executablePath?: string
            installationPath?: string
            packageAvailable: boolean
            capabilities: Record<string, boolean>
          }>
        >
      >,
    install: (kernelId: string) =>
      ipcRenderer.invoke('kernel:install', kernelId) as Promise<
        IpcResult<{
          id: string
          label: string
          family: string
          platform: string
          arch: string
          version: string
          status: string
          executablePath?: string
          installationPath?: string
          packageAvailable: boolean
          capabilities: Record<string, boolean>
        }>
      >,
  },
  proxy: {
    list: () =>
      ipcRenderer.invoke('proxy:list') as Promise<
        IpcResult<
          ReadonlyArray<{
            proxyId: string
            type: string
            host: string
            port: number
            username?: string
            credentialRef?: string
            createdAt: string
            updatedAt: string
          }>
        >
      >,
    save: (input: SaveProxyInput) =>
      ipcRenderer.invoke('proxy:save', input) as Promise<
        IpcResult<{
          proxyId: string
          type: string
          host: string
          port: number
          username?: string
          credentialRef?: string
          createdAt: string
          updatedAt: string
        }>
      >,
    delete: (proxyId: string) =>
      ipcRenderer.invoke('proxy:delete', proxyId) as Promise<IpcResult<boolean>>,
  },
  environment: {
    list: () => ipcRenderer.invoke('environment:list') as Promise<IpcResult<EnvironmentSummary[]>>,
    create: (input: CreateEnvironmentInput) =>
      ipcRenderer.invoke('environment:create', input) as Promise<IpcResult<EnvironmentSummary>>,
    start: (environmentId: string) =>
      ipcRenderer.invoke('environment:start', environmentId) as Promise<
        IpcResult<EnvironmentSummary>
      >,
    stop: (environmentId: string) =>
      ipcRenderer.invoke('environment:stop', environmentId) as Promise<
        IpcResult<EnvironmentSummary>
      >,
    recover: (environmentId: string) =>
      ipcRenderer.invoke('environment:recover', environmentId) as Promise<
        IpcResult<EnvironmentSummary>
      >,
  },
  worker: {
    runSmoke: (task: WorkerTask) =>
      ipcRenderer.invoke('worker:run-smoke', task) as Promise<IpcResult<WorkerResult>>,
    cancel: (taskId: string) =>
      ipcRenderer.invoke('worker:cancel', taskId) as Promise<IpcResult<boolean>>,
  },
} as const

contextBridge.exposeInMainWorld('contextweave', api)

export type ContextWeaveApi = typeof api
