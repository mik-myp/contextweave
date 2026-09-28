import {
  workspaceContextSchema,
  type WorkspaceContext,
  type IpcResult,
} from '@contextweave/contracts'

/** Captures the owner once. In-flight commands and cancellation never consult a later selection. */
export function createWorkspaceApi(input: WorkspaceContext) {
  const context = Object.freeze(workspaceContextSchema.parse(input))
  function bindWorkspace<Args extends unknown[], T>(
    method: () => (context: WorkspaceContext, ...args: Args) => Promise<IpcResult<T>>,
  ) {
    return (...args: Args) => method()(context, ...args)
  }
  return {
    batch: {
      preview: bindWorkspace(() => window.contextweave.batch.preview),
      confirm: bindWorkspace(() => window.contextweave.batch.confirm),
      page: bindWorkspace(() => window.contextweave.batch.page),
      get: bindWorkspace(() => window.contextweave.batch.get),
      cancel: bindWorkspace(() => window.contextweave.batch.cancel),
      retryPreview: bindWorkspace(() => window.contextweave.batch.retryPreview),
    },
    organization: {
      createTag: bindWorkspace(() => window.contextweave.organization.createTag),
      updateTag: bindWorkspace(() => window.contextweave.organization.updateTag),
      deleteTag: bindWorkspace(() => window.contextweave.organization.deleteTag),
      list: bindWorkspace(() => window.contextweave.organization.list),
      createGroup: bindWorkspace(() => window.contextweave.organization.createGroup),
      updateGroup: bindWorkspace(() => window.contextweave.organization.updateGroup),
      deleteGroup: bindWorkspace(() => window.contextweave.organization.deleteGroup),
      saveEnvironment: bindWorkspace(() => window.contextweave.organization.saveEnvironment),
      createView: bindWorkspace(() => window.contextweave.organization.createView),
      updateView: bindWorkspace(() => window.contextweave.organization.updateView),
      deleteView: bindWorkspace(() => window.contextweave.organization.deleteView),
    },
    kernel: {
      providers: bindWorkspace(() => window.contextweave.kernel.providers),
      prepareCustom: bindWorkspace(() => window.contextweave.kernel.prepareCustom),
      catalog: bindWorkspace(() => window.contextweave.kernel.catalog),
      remove: bindWorkspace(() => window.contextweave.kernel.remove),
      cancelInstall: bindWorkspace(() => window.contextweave.kernel.cancelInstall),
      list: bindWorkspace(() => window.contextweave.kernel.list),
      install: bindWorkspace(() => window.contextweave.kernel.install),
    },
    operation: {
      page: bindWorkspace(() => window.contextweave.operation.page),
      list: bindWorkspace(() => window.contextweave.operation.list),
    },
    storage: {
      getArtifactBudget: bindWorkspace(() => window.contextweave.storage.getArtifactBudget),
      updateArtifactBudget: bindWorkspace(() => window.contextweave.storage.updateArtifactBudget),
      pageArtifacts: bindWorkspace(() => window.contextweave.storage.pageArtifacts),
      previewHistoryCleanup: bindWorkspace(() => window.contextweave.storage.previewHistoryCleanup),
      confirmHistoryCleanup: bindWorkspace(() => window.contextweave.storage.confirmHistoryCleanup),
      getHistoryCleanupReceipt: bindWorkspace(
        () => window.contextweave.storage.getHistoryCleanupReceipt,
      ),
      orphans: bindWorkspace(() => window.contextweave.storage.orphans),
    },
    activity: {
      page: bindWorkspace(() => window.contextweave.activity.page),
      list: bindWorkspace(() => window.contextweave.activity.list),
    },
    proxy: {
      import: bindWorkspace(() => window.contextweave.proxy.import),
      cleanupStatus: bindWorkspace(() => window.contextweave.proxy.cleanupStatus),
      retryCleanup: bindWorkspace(() => window.contextweave.proxy.retryCleanup),
      test: bindWorkspace(() => window.contextweave.proxy.test),
      list: bindWorkspace(() => window.contextweave.proxy.list),
      save: bindWorkspace(() => window.contextweave.proxy.save),
      delete: bindWorkspace(() => window.contextweave.proxy.delete),
    },
    environment: {
      commandPage: bindWorkspace(() => window.contextweave.environment.commandPage),
      activeCommands: bindWorkspace(() => window.contextweave.environment.activeCommands),
      inspectRecovery: bindWorkspace(() => window.contextweave.environment.inspectRecovery),
      submitCommand: bindWorkspace(() => window.contextweave.environment.submitCommand),
      commandReceipt: bindWorkspace(() => window.contextweave.environment.commandReceipt),
      cancelCommand: bindWorkspace(() => window.contextweave.environment.cancelCommand),
      detectLocale: bindWorkspace(() => window.contextweave.environment.detectLocale),
      cancelLocale: bindWorkspace(() => window.contextweave.environment.cancelLocale),
      preflight: bindWorkspace(() => window.contextweave.environment.preflight),
      trash: bindWorkspace(() => window.contextweave.environment.trash),
      restore: bindWorkspace(() => window.contextweave.environment.restore),
      get: bindWorkspace(() => window.contextweave.environment.get),
      update: bindWorkspace(() => window.contextweave.environment.update),
      delete: bindWorkspace(() => window.contextweave.environment.delete),
      list: bindWorkspace(() => window.contextweave.environment.list),
      create: bindWorkspace(() => window.contextweave.environment.create),
      start: bindWorkspace(() => window.contextweave.environment.start),
      stop: bindWorkspace(() => window.contextweave.environment.stop),
      recover: bindWorkspace(() => window.contextweave.environment.recover),
    },
    worker: {
      runSmoke: bindWorkspace(() => window.contextweave.worker.runSmoke),
      cancel: bindWorkspace(() => window.contextweave.worker.cancel),
    },
  }
}
export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>
