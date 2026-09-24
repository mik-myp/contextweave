import { z } from 'zod'
import { contextBridge, ipcRenderer } from 'electron'
import {
  appLogEntrySchema,
  appLogSnapshotSchema,
  appUpdateStateSchema,
  environmentDetailsSchema,
  kernelSummarySchema,
  kernelCatalogSchema,
  kernelCatalogInputSchema,
  kernelProviderSchema,
  kernelReleaseSchema,
  customKernelSourceSchema,
  type CustomKernelSource,
  operationSummarySchema,
  preflightReportSchema,
  orphanDirectorySchema,
  dataChangedSchema,
  themeConfigSchema,
  type DataDomain,
  proxySummarySchema,
  proxyTestInputSchema,
  proxyTestResultSchema,
  type ProxyTestInput,
  saveProxyInputSchema,
  activitySummarySchema,
  environmentSummarySchema,
  environmentIdSchema,
  createEnvironmentInputSchema,
  updateEnvironmentInputSchema,
  ipcResultSchema,
  type CreateEnvironmentInput,
  type UpdateEnvironmentInput,
  type SaveProxyInput,
  type ThemeConfig,
} from '@contextweave/contracts'
import {
  workerResultSchema,
  workerTaskSchema,
  type WorkerTask,
} from '@contextweave/worker-protocol'

const api = {
  app: {
    quit: async () => ipcResultSchema(z.boolean()).parse(await ipcRenderer.invoke('app:quit')),
    getInfo: async () =>
      ipcResultSchema(
        z.object({
          name: z.string(),
          version: z.string(),
          platform: z.string(),
          arch: z.string(),
          secureStorageAvailable: z.boolean(),
        }),
      ).parse(await ipcRenderer.invoke('app:get-info')),
    getPaths: async () =>
      ipcResultSchema(
        z.object({
          userData: z.string(),
          dataRoot: z.string(),
          environmentRoot: z.string(),
          kernelRoot: z.string(),
          logRoot: z.string(),
        }),
      ).parse(await ipcRenderer.invoke('app:get-paths')),
    openExternal: async (url: string) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('app:open-external', z.string().url().parse(url)),
      ),
  },
  logs: {
    copy: async (entryId: number) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('logs:copy', appLogEntrySchema.shape.id.parse(entryId)),
      ),
    list: async () =>
      ipcResultSchema(appLogSnapshotSchema).parse(await ipcRenderer.invoke('logs:list')),
    clear: async () =>
      ipcResultSchema(appLogSnapshotSchema).parse(await ipcRenderer.invoke('logs:clear')),
  },
  update: {
    getState: async () =>
      ipcResultSchema(appUpdateStateSchema).parse(await ipcRenderer.invoke('update:state')),
    check: async () =>
      ipcResultSchema(appUpdateStateSchema).parse(await ipcRenderer.invoke('update:check')),
    download: async () =>
      ipcResultSchema(appUpdateStateSchema).parse(await ipcRenderer.invoke('update:download')),
    cancel: async () =>
      ipcResultSchema(appUpdateStateSchema).parse(await ipcRenderer.invoke('update:cancel')),
    openInstaller: async () =>
      ipcResultSchema(appUpdateStateSchema).parse(
        await ipcRenderer.invoke('update:open-installer'),
      ),
    openRelease: async () =>
      ipcResultSchema(z.boolean()).parse(await ipcRenderer.invoke('update:open-release')),
  },
  settings: {
    getTheme: async () =>
      ipcResultSchema(themeConfigSchema).parse(await ipcRenderer.invoke('settings:get-theme')),
    setTheme: async (theme: ThemeConfig) =>
      ipcResultSchema(themeConfigSchema).parse(
        await ipcRenderer.invoke('settings:set-theme', themeConfigSchema.parse(theme)),
      ),
  },
  events: {
    onDataChanged: (listener: (domains: DataDomain[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = dataChangedSchema.safeParse(value)
        if (parsed.success) listener(parsed.data.domains)
      }
      ipcRenderer.on('data:changed', handler)
      return () => {
        ipcRenderer.removeListener('data:changed', handler)
      }
    },
  },
  kernel: {
    providers: async () =>
      ipcResultSchema(z.array(kernelProviderSchema)).parse(
        await ipcRenderer.invoke('kernel:providers'),
      ),
    prepareCustom: async (input: CustomKernelSource) =>
      ipcResultSchema(kernelReleaseSchema).parse(
        await ipcRenderer.invoke('kernel:prepare-custom', customKernelSourceSchema.parse(input)),
      ),
    catalog: async (providerId = 'fingerprint-chromium', refresh = false) =>
      ipcResultSchema(kernelCatalogSchema).parse(
        await ipcRenderer.invoke(
          'kernel:catalog',
          kernelCatalogInputSchema.parse({ providerId, refresh }),
        ),
      ),
    cancelInstall: async (kernelId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('kernel:cancel-install', environmentIdSchema.parse(kernelId)),
      ),
    list: async () =>
      ipcResultSchema(z.array(kernelSummarySchema)).parse(await ipcRenderer.invoke('kernel:list')),
    install: async (kernelId: string) =>
      ipcResultSchema(kernelSummarySchema).parse(
        await ipcRenderer.invoke('kernel:install', environmentIdSchema.parse(kernelId)),
      ),
  },
  operation: {
    list: async () =>
      ipcResultSchema(z.array(operationSummarySchema)).parse(
        await ipcRenderer.invoke('operation:list'),
      ),
  },
  storage: {
    orphans: async () =>
      ipcResultSchema(z.array(orphanDirectorySchema)).parse(
        await ipcRenderer.invoke('storage:orphans'),
      ),
  },
  activity: {
    list: async () =>
      ipcResultSchema(z.array(activitySummarySchema)).parse(
        await ipcRenderer.invoke('activity:list'),
      ),
  },
  proxy: {
    test: async (input: ProxyTestInput) =>
      ipcResultSchema(proxyTestResultSchema).parse(
        await ipcRenderer.invoke('proxy:test', proxyTestInputSchema.parse(input)),
      ),
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
    preflight: async (id: string) =>
      ipcResultSchema(preflightReportSchema).parse(
        await ipcRenderer.invoke('environment:preflight', environmentIdSchema.parse(id)),
      ),
    trash: async () =>
      ipcResultSchema(z.array(environmentSummarySchema)).parse(
        await ipcRenderer.invoke('environment:trash-list'),
      ),
    restore: async (id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:restore', environmentIdSchema.parse(id)),
      ),
    get: async (id: string) =>
      ipcResultSchema(environmentDetailsSchema).parse(
        await ipcRenderer.invoke('environment:get', environmentIdSchema.parse(id)),
      ),
    update: async (input: UpdateEnvironmentInput) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:update', updateEnvironmentInputSchema.parse(input)),
      ),
    delete: async (id: string) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('environment:delete', environmentIdSchema.parse(id)),
      ),
    list: async () =>
      ipcResultSchema(z.array(environmentSummarySchema)).parse(
        await ipcRenderer.invoke('environment:list'),
      ),
    create: async (input: CreateEnvironmentInput) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:create', createEnvironmentInputSchema.parse(input)),
      ),
    start: async (id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:start', environmentIdSchema.parse(id)),
      ),
    stop: async (id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:stop', environmentIdSchema.parse(id)),
      ),
    recover: async (id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await ipcRenderer.invoke('environment:recover', environmentIdSchema.parse(id)),
      ),
  },
  worker: {
    runSmoke: async (task: WorkerTask) =>
      ipcResultSchema(workerResultSchema).parse(
        await ipcRenderer.invoke('worker:run-smoke', workerTaskSchema.parse(task)),
      ),
    cancel: async (taskId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('worker:cancel', z.string().min(1).parse(taskId)),
      ),
  },
} as const

contextBridge.exposeInMainWorld('contextweave', api)

export type ContextWeaveApi = typeof api
