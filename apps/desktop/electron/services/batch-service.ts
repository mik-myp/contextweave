import { randomUUID } from 'node:crypto'
import {
  assertWorkspaceContext,
  batchIdSchema,
  batchPreviewInputSchema,
  batchPreviewSchema,
  batchReasonSchema,
  isBatchActive,
  type BatchAction,
  type BatchPreview,
  type BatchReason,
  type BatchTarget,
  type IpcResult,
} from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'
import { assertEnvironmentEditable } from '../environment-management'

export const batchPreviewTtlMs = 5 * 60_000
/** A single Main-owned queue. Neither a view nor an IPC promise owns its lifetime. */
export function createBatchService(options: {
  repository: EnvironmentRepository
  busy(id: string): boolean
  execute(action: BatchAction, id: string, revision: number): Promise<IpcResult<unknown>>
  changed(): void
  clock?: { now(): number; monotonic(): number }
}) {
  const { repository, changed } = options,
    store = repository.batches
  const clock = options.clock ?? { now: () => Date.now(), monotonic: () => performance.now() }
  const previews = new Map<string, { preview: BatchPreview; deadline: number }>()
  let closing = false,
    fatal = false,
    draining: Promise<void> | undefined
  const timestamp = () => new Date(clock.now()).toISOString()
  const ensureHealthy = () => {
    if (fatal) throw new Error('BATCH_STORAGE_FAILED')
  }
  const ensureOpen = () => {
    ensureHealthy()
    if (closing) throw new Error('APP_CLOSING')
  }
  const storage = <T>(action: () => T): T => {
    try {
      return action()
    } catch (error) {
      // Storage write failures are not command failures. Stop the queue; unresolved
      // running effects stay unknown for startup recovery, never falsely successful.
      fatal = true
      throw new Error('BATCH_STORAGE_FAILED', { cause: error })
    }
  }
  function inspect(action: BatchAction, id: string, revision?: number): BatchTarget {
    const record = repository.get(id)
    if (!record) return { environmentId: id, name: '', revision: null, reason: 'NOT_FOUND' }
    assertWorkspaceContext(repository.context, { workspaceId: record.workspaceId })
    let reason: BatchReason | null = null
    if (revision !== undefined && revision !== record.revision) reason = 'CONFIG_CONFLICT'
    else if (options.busy(id)) reason = 'OPERATION_IN_PROGRESS'
    else if (action === 'restore' && record.lifecycle !== 'trashed')
      reason = 'ENVIRONMENT_NOT_TRASHED'
    else if (action !== 'restore' && record.lifecycle === 'trashed') reason = 'ENVIRONMENT_TRASHED'
    else if (action === 'stop' && record.status !== 'running') reason = 'ENVIRONMENT_NOT_RUNNING'
    else if (action !== 'stop') {
      try {
        assertEnvironmentEditable(repository, record)
      } catch {
        reason = 'ENVIRONMENT_BUSY'
      }
    }
    return { environmentId: id, name: record.name, revision: record.revision, reason }
  }
  function preview(input: unknown, sourceTaskId: string | null = null): BatchPreview {
    ensureOpen()
    const request = batchPreviewInputSchema.parse(input)
    for (const [id, value] of previews)
      if (clock.monotonic() >= value.deadline || clock.now() >= Date.parse(value.preview.expiresAt))
        previews.delete(id)
    if (previews.size >= 20) throw new Error('BATCH_PREVIEW_LIMIT')
    const value = batchPreviewSchema.parse({
      workspaceId: repository.workspaceId,
      id: randomUUID(),
      action: request.action,
      sourceTaskId,
      createdAt: timestamp(),
      expiresAt: new Date(clock.now() + batchPreviewTtlMs).toISOString(),
      targets: request.environmentIds.map((id) => inspect(request.action, id)),
    })
    previews.set(value.id, {
      preview: structuredClone(value),
      deadline: clock.monotonic() + batchPreviewTtlMs,
    })
    return value
  }
  async function run() {
    while (!closing && !fatal) {
      const task = store.nextQueued()
      if (!task) return
      const item = task.items.find((value) => value.status === 'queued')
      if (!item) throw new Error('BATCH_STATE_CONFLICT')
      const check = inspect(task.action, item.environmentId, item.revision ?? undefined)
      if (check.reason) {
        storage(() => store.finishItem(task.id, item.ordinal, 'skipped', check.reason, timestamp()))
        changed()
        continue
      }
      if (item.revision === null) throw new Error('BATCH_STATE_CONFLICT')
      storage(() => store.startItem(task.id, item.ordinal, timestamp()))
      changed()
      let result: IpcResult<unknown>
      try {
        result = await options.execute(task.action, item.environmentId, item.revision)
      } catch {
        result = { ok: false, code: 'COMMAND_FAILED', message: 'COMMAND_FAILED' }
      }
      const reason = result.ok
        ? null
        : (batchReasonSchema.safeParse(result.code).data ?? 'COMMAND_FAILED')
      const skipped =
        !result.ok &&
        [
          'CONFIG_CONFLICT',
          'OPERATION_IN_PROGRESS',
          'ENVIRONMENT_BUSY',
          'NOT_FOUND',
          'ENVIRONMENT_TRASHED',
        ].includes(result.code)
      const status = result.ok
        ? 'succeeded'
        : reason === 'CANCELLED'
          ? 'cancelled'
          : skipped
            ? 'skipped'
            : 'failed'
      storage(() => store.finishItem(task.id, item.ordinal, status, reason, timestamp()))
      changed()
    }
  }
  function kick() {
    if (draining || closing || fatal) return
    // Reserve the runner before any asynchronous work can yield/re-enter confirm.
    draining = Promise.resolve()
      .then(run)
      .catch(() => {
        fatal = true
        changed()
      })
      .finally(() => {
        draining = undefined
      })
  }
  return {
    preview: (input: unknown) => preview(input),
    confirm(input: unknown) {
      ensureOpen()
      const id = batchIdSchema.parse(input),
        previous = store.get(id)
      if (previous) return previous
      const candidate = previews.get(id)
      if (!candidate) throw new Error('BATCH_PREVIEW_INVALID')
      if (
        clock.monotonic() >= candidate.deadline ||
        clock.now() >= Date.parse(candidate.preview.expiresAt)
      ) {
        previews.delete(id)
        throw new Error('BATCH_PREVIEW_EXPIRED')
      }
      const task = storage(() => store.create(candidate.preview, timestamp()))
      previews.delete(id)
      changed()
      kick()
      return task
    },
    page(input: unknown) {
      ensureHealthy()
      return store.page(input)
    },
    get(input: unknown) {
      ensureHealthy()
      const task = store.get(input)
      if (!task) throw new Error('NOT_FOUND')
      return task
    },
    cancel(input: unknown) {
      ensureHealthy()
      const id = batchIdSchema.parse(input)
      if (!store.get(id)) throw new Error('NOT_FOUND')
      const task = storage(() => store.cancel(id, timestamp()))
      changed()
      return task
    },
    retryPreview(input: unknown) {
      ensureOpen()
      const task = store.get(batchIdSchema.parse(input))
      if (!task) throw new Error('NOT_FOUND')
      if (isBatchActive(task.status)) throw new Error('BATCH_NOT_FINISHED')
      const environmentIds = task.items
        .filter((item) => item.status === 'failed')
        .map((item) => item.environmentId)
      if (!environmentIds.length) throw new Error('BATCH_NO_FAILED_ITEMS')
      return preview({ action: task.action, environmentIds }, task.id)
    },
    recover() {
      storage(() => store.recoverInterrupted(timestamp()))
      changed()
    },
    hasActive: () => Boolean(draining) || Boolean(store.nextQueued()),
    drain: async () => {
      await draining
    },
    async shutdown() {
      closing = true
      previews.clear()
      // Even if persistence fails, await the in-flight effect before the DB closes.
      let failure: unknown
      try {
        storage(() => store.cancelQueued(timestamp()))
        changed()
      } catch (error) {
        failure = error
      }
      await draining
      if (failure) throw failure
    },
  }
}
