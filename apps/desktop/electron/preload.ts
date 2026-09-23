import { z } from 'zod'
import { contextBridge, ipcRenderer } from 'electron'
import {
  environmentDetailsSchema,
  proxySummarySchema,
  saveProxyInputSchema,
  activitySummarySchema,
  environmentSummarySchema,
  environmentIdSchema,
  createEnvironmentInputSchema,
  updateEnvironmentInputSchema,
  ipcResultSchema,
  type CreateEnvironmentInput,
  type UpdateEnvironmentInput,
  type IpcResult,
  type EnvironmentSummary,
  type SaveProxyInput,
  type ThemeConfig,
} from '@contextweave/contracts'
import type { WorkerResult, WorkerTask } from '@contextweave/worker-protocol'

const api = {
  app: {
    quit: () => ipcRenderer.invoke('app:quit') as Promise<IpcResult<boolean>>,
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
  activity: {
    list: async () =>
      ipcResultSchema(z.array(activitySummarySchema)).parse(
        await ipcRenderer.invoke('activity:list'),
      ),
  },
  proxy: {
    list: async () =>
      ipcResultSchema(z.array(proxySummarySchema)).parse(await ipcRenderer.invoke('proxy:list')),
    save: async (input: SaveProxyInput) =>
      ipcResultSchema(proxySummarySchema).parse(
        await ipcRenderer.invoke('proxy:save', saveProxyInputSchema.parse(input)),
      ),
    delete: async (proxyId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('proxy:delete', z.string().min(1).parse(proxyId)),
      ),
  },
  environment: {
    get: async (id: string) =>
      ipcResultSchema(environmentDetailsSchema).parse(
        await ipcRenderer.invoke('environment:get', environmentIdSchema.parse(id)),
      ),
    update: async (input: UpdateEnvironmentInput) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:update', updateEnvironmentInputSchema.parse(input)),
      ),
    delete: (id: string) =>
      ipcRenderer.invoke('environment:delete', id) as Promise<IpcResult<boolean>>,
    list: () => ipcRenderer.invoke('environment:list') as Promise<IpcResult<EnvironmentSummary[]>>,
    create: async (input: CreateEnvironmentInput) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:create', createEnvironmentInputSchema.parse(input)),
      ),
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
