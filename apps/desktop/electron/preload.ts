import {
  environmentCommandRequestSchema,
  environmentCommandReceiptSchema,
  environmentRecoveryInspectionSchema,
  environmentCommandPageInputSchema,
  environmentCommandPageSchema,
  environmentCommandActiveSchema,
  type EnvironmentCommandPageInput,
  commandRequestIdSchema,
  type EnvironmentCommandRequest,
} from '@contextweave/contracts'
import {
  batchPreviewInputSchema,
  batchPreviewSchema,
  batchIdSchema,
  batchPageInputSchema,
  batchPageSchema,
  batchTaskSchema,
  type BatchAction,
  type BatchPageInput,
} from '@contextweave/contracts'
import {
  organizationSnapshotSchema,
  createGroupSchema,
  updateGroupSchema,
  reviseOrganizationItemSchema,
  createEnvironmentViewSchema,
  updateEnvironmentViewSchema,
  saveEnvironmentOrganizationSchema,
  environmentOrganizationSchema,
  environmentGroupSchema,
  savedEnvironmentViewSchema,
} from '@contextweave/contracts'
import {
  assertWorkspaceContext,
  workspaceContextSchema,
  type WorkspaceContext,
} from '@contextweave/contracts'
import { localWorkspaceSchema } from '@contextweave/contracts'
import {
  artifactBudgetSchema,
  artifactBudgetUpdateSchema,
  type ArtifactBudgetUpdate,
  artifactQuerySchema,
  artifactPageSchema,
  type ArtifactQuery,
} from '@contextweave/contracts'
import { z } from 'zod'
import { contextBridge, ipcRenderer } from 'electron'
import {
  historyCleanupRequestSchema,
  historyCleanupConfirmSchema,
  historyCleanupPreviewSchema,
  historyCleanupReceiptSchema,
  historyCleanupResultSchema,
  type HistoryCleanupRetentionDays,
  appInfoSchema,
  appPathsSchema,
  externalUrlSchema,
  ipLocaleRequestSchema,
  ipLocaleResultSchema,
  ipLocaleCancelSchema,
  type IpLocaleRequest,
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
  credentialCleanupStatusSchema,
  importProxiesInputSchema,
  importProxiesResultSchema,
  type ImportProxiesInput,
  proxyTestInputSchema,
  proxyTestResultSchema,
  type ProxyTestInput,
  saveProxyInputSchema,
  activitySummarySchema,
  activityHistoryQuerySchema,
  activityHistoryPageSchema,
  type ActivityHistoryQuery,
  operationHistoryQuerySchema,
  operationHistoryPageSchema,
  type OperationHistoryQuery,
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
  workerTaskIdSchema,
  workerResultSchema,
  workerTaskSchema,
  type WorkerTask,
} from '@contextweave/worker-protocol'

async function invokeWorkspace(context: WorkspaceContext, channel: string, payload?: unknown) {
  const owner = workspaceContextSchema.parse(context)
  const result = ipcResultSchema(z.unknown()).parse(
    await ipcRenderer.invoke(channel, { ...owner, payload }),
  )
  if (result.ok) {
    const data = result.data
    if (data !== null && typeof data === 'object' && 'workspaceId' in data)
      assertWorkspaceContext(owner, { workspaceId: data.workspaceId })
    const records = Array.isArray(data)
      ? data
      : data !== null && typeof data === 'object' && 'items' in data && Array.isArray(data.items)
        ? data.items
        : [data]
    for (const record of records) {
      if (record !== null && typeof record === 'object' && 'workspaceId' in record)
        assertWorkspaceContext(owner, { workspaceId: record.workspaceId })
    }
  }
  return result
}

async function invokeEnvironmentCommand(
  context: WorkspaceContext,
  channel: 'environment:command' | 'environment:command-get' | 'environment:command-cancel',
  payload: EnvironmentCommandRequest | string,
) {
  const result = ipcResultSchema(environmentCommandReceiptSchema).parse(
    await invokeWorkspace(context, channel, payload),
  )
  if (result.ok) {
    const id = typeof payload === 'string' ? payload : payload.requestId
    if (result.data.requestId !== id) throw new Error('COMMAND_RECEIPT_MISMATCH')
    if (typeof payload !== 'string') {
      if (result.data.kind !== payload.kind) throw new Error('COMMAND_RECEIPT_MISMATCH')
      if (payload.kind !== 'create') {
        const target = payload.kind === 'update' ? payload.input : payload
        if (
          result.data.environmentId !== target.environmentId ||
          result.data.expectedRevision !== target.expectedRevision
        )
          throw new Error('COMMAND_RECEIPT_MISMATCH')
      }
    }
  }
  return result
}

const api = {
  batch: {
    preview: async (
      context: WorkspaceContext,
      input: { action: BatchAction; environmentIds: string[] },
    ) =>
      ipcResultSchema(batchPreviewSchema).parse(
        await invokeWorkspace(context, 'batch:preview', batchPreviewInputSchema.parse(input)),
      ),
    confirm: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(batchTaskSchema).parse(
        await invokeWorkspace(context, 'batch:confirm', batchIdSchema.parse(id)),
      ),
    page: async (context: WorkspaceContext, input: BatchPageInput) =>
      ipcResultSchema(batchPageSchema).parse(
        await invokeWorkspace(context, 'batch:page', batchPageInputSchema.parse(input)),
      ),
    get: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(batchTaskSchema).parse(
        await invokeWorkspace(context, 'batch:get', batchIdSchema.parse(id)),
      ),
    cancel: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(batchTaskSchema).parse(
        await invokeWorkspace(context, 'batch:cancel', batchIdSchema.parse(id)),
      ),
    retryPreview: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(batchPreviewSchema).parse(
        await invokeWorkspace(context, 'batch:retry-preview', batchIdSchema.parse(id)),
      ),
  },
  organization: {
    list: async (context: WorkspaceContext) =>
      ipcResultSchema(organizationSnapshotSchema).parse(
        await invokeWorkspace(context, 'organization:list'),
      ),
    createGroup: async (context: WorkspaceContext, input: z.input<typeof createGroupSchema>) =>
      ipcResultSchema(environmentGroupSchema).parse(
        await invokeWorkspace(context, 'organization:group-create', createGroupSchema.parse(input)),
      ),
    updateGroup: async (context: WorkspaceContext, input: z.input<typeof updateGroupSchema>) =>
      ipcResultSchema(environmentGroupSchema).parse(
        await invokeWorkspace(context, 'organization:group-update', updateGroupSchema.parse(input)),
      ),
    deleteGroup: async (
      context: WorkspaceContext,
      input: z.input<typeof reviseOrganizationItemSchema>,
    ) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(
          context,
          'organization:group-delete',
          reviseOrganizationItemSchema.parse(input),
        ),
      ),
    saveEnvironment: async (
      context: WorkspaceContext,
      input: z.input<typeof saveEnvironmentOrganizationSchema>,
    ) =>
      ipcResultSchema(environmentOrganizationSchema).parse(
        await invokeWorkspace(
          context,
          'organization:metadata-save',
          saveEnvironmentOrganizationSchema.parse(input),
        ),
      ),
    createView: async (
      context: WorkspaceContext,
      input: z.input<typeof createEnvironmentViewSchema>,
    ) =>
      ipcResultSchema(savedEnvironmentViewSchema).parse(
        await invokeWorkspace(
          context,
          'organization:view-create',
          createEnvironmentViewSchema.parse(input),
        ),
      ),
    updateView: async (
      context: WorkspaceContext,
      input: z.input<typeof updateEnvironmentViewSchema>,
    ) =>
      ipcResultSchema(savedEnvironmentViewSchema).parse(
        await invokeWorkspace(
          context,
          'organization:view-update',
          updateEnvironmentViewSchema.parse(input),
        ),
      ),
    deleteView: async (
      context: WorkspaceContext,
      input: z.input<typeof reviseOrganizationItemSchema>,
    ) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(
          context,
          'organization:view-delete',
          reviseOrganizationItemSchema.parse(input),
        ),
      ),
  },

  workspace: {
    current: async (...args: []) => {
      z.tuple([]).parse(args)
      return ipcResultSchema(localWorkspaceSchema).parse(
        await ipcRenderer.invoke('workspace:current'),
      )
    },
  },
  app: {
    quit: async () => ipcResultSchema(z.boolean()).parse(await ipcRenderer.invoke('app:quit')),
    getInfo: async () =>
      ipcResultSchema(appInfoSchema).parse(await ipcRenderer.invoke('app:get-info')),
    getPaths: async () =>
      ipcResultSchema(appPathsSchema).parse(await ipcRenderer.invoke('app:get-paths')),
    openExternal: async (url: string) =>
      ipcResultSchema(z.boolean()).parse(
        await ipcRenderer.invoke('app:open-external', externalUrlSchema.parse(url)),
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
    install: async () =>
      ipcResultSchema(appUpdateStateSchema).parse(await ipcRenderer.invoke('update:install')),
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
    onDataChanged: (context: WorkspaceContext, listener: (domains: DataDomain[]) => void) => {
      const owner = workspaceContextSchema.parse(context)
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = dataChangedSchema.safeParse(value)
        if (parsed.success && parsed.data.workspaceId === owner.workspaceId)
          listener(parsed.data.domains)
      }
      ipcRenderer.on('data:changed', handler)
      return () => {
        ipcRenderer.removeListener('data:changed', handler)
      }
    },
  },
  kernel: {
    providers: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(kernelProviderSchema)).parse(
        await invokeWorkspace(context, 'kernel:providers'),
      ),
    prepareCustom: async (context: WorkspaceContext, input: CustomKernelSource) =>
      ipcResultSchema(kernelReleaseSchema).parse(
        await invokeWorkspace(
          context,
          'kernel:prepare-custom',
          customKernelSourceSchema.parse(input),
        ),
      ),
    catalog: async (
      context: WorkspaceContext,
      providerId = 'fingerprint-chromium',
      refresh = false,
    ) =>
      ipcResultSchema(kernelCatalogSchema).parse(
        await invokeWorkspace(
          context,
          'kernel:catalog',
          kernelCatalogInputSchema.parse({ providerId, refresh }),
        ),
      ),
    remove: async (context: WorkspaceContext, kernelId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(context, 'kernel:remove', environmentIdSchema.parse(kernelId)),
      ),
    cancelInstall: async (context: WorkspaceContext, kernelId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(
          context,
          'kernel:cancel-install',
          environmentIdSchema.parse(kernelId),
        ),
      ),
    list: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(kernelSummarySchema)).parse(
        await invokeWorkspace(context, 'kernel:list'),
      ),
    install: async (context: WorkspaceContext, kernelId: string) =>
      ipcResultSchema(kernelSummarySchema).parse(
        await invokeWorkspace(context, 'kernel:install', environmentIdSchema.parse(kernelId)),
      ),
  },
  operation: {
    page: async (context: WorkspaceContext, input: Partial<OperationHistoryQuery> = {}) =>
      ipcResultSchema(operationHistoryPageSchema).parse(
        await invokeWorkspace(context, 'operation:page', operationHistoryQuerySchema.parse(input)),
      ),
    list: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(operationSummarySchema)).parse(
        await invokeWorkspace(context, 'operation:list'),
      ),
  },
  storage: {
    getArtifactBudget: async (context: WorkspaceContext) =>
      ipcResultSchema(artifactBudgetSchema).parse(
        await invokeWorkspace(context, 'storage:artifact-budget'),
      ),
    updateArtifactBudget: async (context: WorkspaceContext, input: ArtifactBudgetUpdate) =>
      ipcResultSchema(artifactBudgetSchema).parse(
        await invokeWorkspace(
          context,
          'storage:artifact-budget-update',
          artifactBudgetUpdateSchema.parse(input),
        ),
      ),
    pageArtifacts: async (context: WorkspaceContext, input: Partial<ArtifactQuery> = {}) =>
      ipcResultSchema(artifactPageSchema).parse(
        await invokeWorkspace(context, 'storage:artifacts-page', artifactQuerySchema.parse(input)),
      ),
    previewHistoryCleanup: async (
      context: WorkspaceContext,
      input: { retentionDays: HistoryCleanupRetentionDays },
    ) =>
      ipcResultSchema(historyCleanupPreviewSchema).parse(
        await invokeWorkspace(
          context,
          'storage:history-preview',
          historyCleanupRequestSchema.parse(input),
        ),
      ),
    confirmHistoryCleanup: async (context: WorkspaceContext, input: { previewId: string }) =>
      ipcResultSchema(historyCleanupResultSchema).parse(
        await invokeWorkspace(
          context,
          'storage:history-confirm',
          historyCleanupConfirmSchema.parse(input),
        ),
      ),
    getHistoryCleanupReceipt: async (context: WorkspaceContext) =>
      ipcResultSchema(historyCleanupReceiptSchema.nullable()).parse(
        await invokeWorkspace(context, 'storage:history-receipt'),
      ),
    orphans: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(orphanDirectorySchema)).parse(
        await invokeWorkspace(context, 'storage:orphans'),
      ),
  },
  activity: {
    page: async (context: WorkspaceContext, input: Partial<ActivityHistoryQuery> = {}) =>
      ipcResultSchema(activityHistoryPageSchema).parse(
        await invokeWorkspace(context, 'activity:page', activityHistoryQuerySchema.parse(input)),
      ),
    list: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(activitySummarySchema)).parse(
        await invokeWorkspace(context, 'activity:list'),
      ),
  },
  proxy: {
    import: async (context: WorkspaceContext, input: ImportProxiesInput) =>
      ipcResultSchema(importProxiesResultSchema).parse(
        await invokeWorkspace(context, 'proxy:import', importProxiesInputSchema.parse(input)),
      ),
    cleanupStatus: async (context: WorkspaceContext) =>
      ipcResultSchema(credentialCleanupStatusSchema).parse(
        await invokeWorkspace(context, 'proxy:cleanup-status'),
      ),
    retryCleanup: async (context: WorkspaceContext) =>
      ipcResultSchema(credentialCleanupStatusSchema).parse(
        await invokeWorkspace(context, 'proxy:retry-cleanup'),
      ),
    test: async (context: WorkspaceContext, input: ProxyTestInput) =>
      ipcResultSchema(proxyTestResultSchema).parse(
        await invokeWorkspace(context, 'proxy:test', proxyTestInputSchema.parse(input)),
      ),
    list: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(proxySummarySchema)).parse(
        await invokeWorkspace(context, 'proxy:list'),
      ),
    save: async (context: WorkspaceContext, input: SaveProxyInput) =>
      ipcResultSchema(proxySummarySchema).parse(
        await invokeWorkspace(context, 'proxy:save', saveProxyInputSchema.parse(input)),
      ),
    delete: async (context: WorkspaceContext, proxyId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(context, 'proxy:delete', z.string().min(1).parse(proxyId)),
      ),
  },
  environment: {
    commandPage: async (context: WorkspaceContext, input: EnvironmentCommandPageInput) =>
      ipcResultSchema(environmentCommandPageSchema).parse(
        await invokeWorkspace(
          context,
          'environment:command-page',
          environmentCommandPageInputSchema.parse(input),
        ),
      ),
    activeCommands: async (context: WorkspaceContext) =>
      ipcResultSchema(environmentCommandActiveSchema).parse(
        await invokeWorkspace(context, 'environment:command-active'),
      ),
    inspectRecovery: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(environmentRecoveryInspectionSchema).parse(
        await invokeWorkspace(
          context,
          'environment:recovery-inspect',
          environmentIdSchema.parse(id),
        ),
      ),
    submitCommand: async (context: WorkspaceContext, input: EnvironmentCommandRequest) =>
      invokeEnvironmentCommand(
        context,
        'environment:command',
        environmentCommandRequestSchema.parse(input),
      ),
    commandReceipt: async (context: WorkspaceContext, requestId: string) =>
      invokeEnvironmentCommand(
        context,
        'environment:command-get',
        commandRequestIdSchema.parse(requestId),
      ),
    cancelCommand: async (context: WorkspaceContext, requestId: string) =>
      invokeEnvironmentCommand(
        context,
        'environment:command-cancel',
        commandRequestIdSchema.parse(requestId),
      ),
    detectLocale: async (context: WorkspaceContext, input: IpLocaleRequest) =>
      ipcResultSchema(ipLocaleResultSchema).parse(
        await invokeWorkspace(
          context,
          'environment:detect-locale',
          ipLocaleRequestSchema.parse(input),
        ),
      ),
    cancelLocale: async (context: WorkspaceContext, requestId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(
          context,
          'environment:cancel-locale',
          ipLocaleCancelSchema.parse(requestId),
        ),
      ),
    preflight: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(preflightReportSchema).parse(
        await invokeWorkspace(context, 'environment:preflight', environmentIdSchema.parse(id)),
      ),
    trash: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(environmentSummarySchema)).parse(
        await invokeWorkspace(context, 'environment:trash-list'),
      ),
    restore: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await invokeWorkspace(context, 'environment:restore', environmentIdSchema.parse(id)),
      ),
    get: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(environmentDetailsSchema).parse(
        await invokeWorkspace(context, 'environment:get', environmentIdSchema.parse(id)),
      ),
    update: async (context: WorkspaceContext, input: UpdateEnvironmentInput) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await invokeWorkspace(
          context,
          'environment:update',
          updateEnvironmentInputSchema.parse(input),
        ),
      ),
    delete: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(context, 'environment:delete', environmentIdSchema.parse(id)),
      ),
    list: async (context: WorkspaceContext) =>
      ipcResultSchema(z.array(environmentSummarySchema)).parse(
        await invokeWorkspace(context, 'environment:list'),
      ),
    create: async (context: WorkspaceContext, input: CreateEnvironmentInput) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await invokeWorkspace(
          context,
          'environment:create',
          createEnvironmentInputSchema.parse(input),
        ),
      ),
    start: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await invokeWorkspace(context, 'environment:start', environmentIdSchema.parse(id)),
      ),
    stop: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await invokeWorkspace(context, 'environment:stop', environmentIdSchema.parse(id)),
      ),
    recover: async (context: WorkspaceContext, id: string) =>
      ipcResultSchema(environmentSummarySchema).parse(
        await invokeWorkspace(context, 'environment:recover', environmentIdSchema.parse(id)),
      ),
  },
  worker: {
    runSmoke: async (context: WorkspaceContext, task: WorkerTask) =>
      ipcResultSchema(workerResultSchema).parse(
        await invokeWorkspace(context, 'worker:run-smoke', workerTaskSchema.parse(task)),
      ),
    cancel: async (context: WorkspaceContext, taskId: string) =>
      ipcResultSchema(z.boolean()).parse(
        await invokeWorkspace(context, 'worker:cancel', workerTaskIdSchema.parse(taskId)),
      ),
  },
} as const

contextBridge.exposeInMainWorld('contextweave', api)

export type ContextWeaveApi = typeof api
