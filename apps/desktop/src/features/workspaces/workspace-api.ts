import {
  workspaceContextSchema,
  type WorkspaceContext,
  type IpcResult,
} from '@contextweave/contracts'

/** Default-local bootstrap only; no cached global selection or implicit Main fallback. */
function bindWorkspace<Args extends unknown[], T>(
  method: () => (context: WorkspaceContext, ...args: Args) => Promise<IpcResult<T>>,
) {
  return async (...args: Args): Promise<IpcResult<T>> => {
    const result = await window.contextweave.workspace.current()
    if (!result.ok) return result
    const context = workspaceContextSchema.parse({ workspaceId: result.data.workspaceId })
    return method()(context, ...args)
  }
}

export const workspaceApi = {
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
