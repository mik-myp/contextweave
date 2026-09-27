import { randomUUID } from 'node:crypto'
import {
  isEnvironmentCommandActive,
  commandRequestIdSchema,
  type CommandErrorCode,
  type EnvironmentCommandReceipt,
  type EnvironmentCommandRequest,
} from '@contextweave/contracts'
import type { EnvironmentCommandRepository } from '@contextweave/storage'
import { normalizeEnvironmentCommand } from './command-intent'

export type CommandOutcome = Pick<EnvironmentCommandReceipt, 'errorCode'> & {
  status: 'succeeded' | 'failed' | 'cancelled' | 'unknown'
}
type Entry = {
  request: EnvironmentCommandRequest
  receipt: EnvironmentCommandReceipt
  completion: Promise<EnvironmentCommandReceipt>
  resolve(receipt: EnvironmentCommandReceipt): void
  reject(error: unknown): void
  executing: boolean
}

/** Owns environment reservations and the single startup lane, not browser lifetimes. */
export function createEnvironmentCommands(options: {
  store: EnvironmentCommandRepository
  execute(
    request: EnvironmentCommandRequest,
    receipt: EnvironmentCommandReceipt,
  ): Promise<CommandOutcome>
  cancelStart(environmentId: string): void
  changed(): void
}) {
  const { store, changed } = options
  const entries = new Map<string, Entry>()
  const starts: Entry[] = []
  let starting: Promise<void> | undefined
  let closing = false
  let fatal = false
  const healthy = () => {
    if (fatal) throw new Error('COMMAND_STORAGE_FAILED')
  }
  function haltQueued() {
    fatal = true
    // Keep unresolved durable facts. Startup can distinguish unstarted from unknown effects.
    for (const entry of entries.values())
      if (!entry.executing) {
        entries.delete(entry.receipt.requestId)
        entry.reject(new Error('COMMAND_STORAGE_FAILED'))
      }
    starts.length = 0
  }
  function storage<T>(action: () => T): T {
    try {
      return action()
    } catch (error) {
      if (error instanceof Error && error.message === 'COMMAND_INTENT_CONFLICT') throw error
      haltQueued()
      throw new Error('COMMAND_STORAGE_FAILED', { cause: error })
    }
  }
  function settle(entry: Entry, receipt: EnvironmentCommandReceipt) {
    entry.receipt = receipt
    entries.delete(receipt.requestId)
    entry.resolve(receipt)
    changed()
  }
  function cancelQueued(entry: Entry, code: 'CANCELLED' | 'APP_CLOSING') {
    const receipt = storage(() =>
      store.finish(entry.receipt.requestId, { status: 'cancelled', errorCode: code }),
    )
    settle(entry, receipt)
    return receipt
  }
  async function execute(entry: Entry) {
    if (!entries.has(entry.receipt.requestId) || entry.executing) return
    try {
      healthy()
      if (closing) {
        cancelQueued(entry, 'APP_CLOSING')
        return
      }
      entry.receipt = storage(() => store.start(entry.receipt.requestId))
      entry.executing = true
      changed()
      let outcome: CommandOutcome
      try {
        outcome = await options.execute(entry.request, entry.receipt)
      } catch {
        // A thrown executor cannot prove that it never reached an external side effect.
        outcome = { status: 'unknown', errorCode: 'COMMAND_RESULT_UNKNOWN' }
      }
      const terminal = storage(() => store.finish(entry.receipt.requestId, outcome))
      if (outcome.errorCode === 'COMMAND_STORAGE_FAILED') haltQueued()
      settle(entry, terminal)
    } catch (error) {
      entries.delete(entry.receipt.requestId)
      entry.reject(error)
      changed()
    }
  }
  function kick() {
    if (starting || closing || fatal) return
    let entry = starts.shift()
    while (entry && !entries.has(entry.receipt.requestId)) entry = starts.shift()
    if (!entry) return
    const next = entry
    starting = Promise.resolve()
      .then(() => execute(next))
      .finally(() => {
        starting = undefined
        kick()
      })
  }
  function submit(input: unknown, rejection?: CommandErrorCode) {
    healthy()
    const { request, intentDigest } = normalizeEnvironmentCommand(
      { workspaceId: store.workspaceId },
      input,
    )
    const previous = storage(() => store.match(request.requestId, intentDigest))
    if (previous) return previous
    const environmentId =
      request.kind === 'create'
        ? `env-${randomUUID()}`
        : request.kind === 'update'
          ? request.input.environmentId
          : request.environmentId
    const expectedRevision =
      request.kind === 'create'
        ? null
        : request.kind === 'update'
          ? request.input.expectedRevision
          : request.expectedRevision
    const active = storage(() => store.active(environmentId))
    const reserved = storage(() =>
      store.reserve(
        {
          version: 1,
          workspaceId: store.workspaceId,
          requestId: request.requestId,
          kind: request.kind,
          environmentId,
          expectedRevision,
          intentDigest,
        },
        closing ? 'APP_CLOSING' : rejection,
      ),
    )
    const receipt = reserved.receipt
    if (!reserved.created || !isEnvironmentCommandActive(receipt.status)) {
      changed()
      return receipt
    }
    let resolve!: Entry['resolve'], reject!: Entry['reject']
    const completion = new Promise<EnvironmentCommandReceipt>((done, fail) => {
      resolve = done
      reject = fail
    })
    // Background commands have no mandatory IPC waiter. Explicit waiters still see this rejection.
    void completion.catch(() => undefined)
    const entry: Entry = { request, receipt, completion, resolve, reject, executing: false }
    entries.set(request.requestId, entry)
    if (request.kind === 'start') {
      starts.push(entry)
      kick()
    } else if (request.kind === 'stop' && active?.kind === 'start') {
      const predecessor = entries.get(active.requestId)
      if (!predecessor) {
        // Startup recovery must precede dispatch. An unowned in-flight fact is never replayed.
        cancelQueued(entry, 'CANCELLED')
      } else {
        void predecessor.completion.then(
          () => execute(entry),
          () => {
            entries.delete(entry.receipt.requestId)
            entry.reject(new Error('COMMAND_STORAGE_FAILED'))
          },
        )
        if (!predecessor.executing) cancelQueued(predecessor, 'CANCELLED')
        else options.cancelStart(environmentId)
      }
    } else {
      void Promise.resolve().then(() => execute(entry))
    }
    changed()
    return receipt
  }
  function get(requestId: string) {
    healthy()
    const id = commandRequestIdSchema.parse(requestId)
    const receipt = storage(() => store.get(id))
    if (!receipt) throw new Error('NOT_FOUND')
    return receipt
  }
  async function wait(requestId: string) {
    healthy()
    const entry = entries.get(commandRequestIdSchema.parse(requestId))
    if (entry) return entry.completion
    return get(requestId)
  }
  async function drain() {
    while (entries.size)
      await Promise.allSettled([...entries.values()].map((entry) => entry.completion))
    await starting
  }
  return {
    submit,
    page: (input: unknown) => {
      healthy()
      return store.page(input)
    },
    active: () => {
      healthy()
      return store.activeList()
    },
    get,
    wait,
    drain,
    busy: (id: string) => Boolean(storage(() => store.active(id))),
    hasActive: () => entries.size > 0,
    cancel(requestId: string) {
      const receipt = get(requestId)
      if (!isEnvironmentCommandActive(receipt.status)) return receipt
      const entry = entries.get(receipt.requestId)
      if (!entry || entry.executing) throw new Error('OPERATION_IN_PROGRESS')
      return cancelQueued(entry, 'CANCELLED')
    },
    cancelIfQueued(requestId: string) {
      healthy()
      const entry = entries.get(commandRequestIdSchema.parse(requestId))
      if (entry && !entry.executing) cancelQueued(entry, 'CANCELLED')
    },
    recover() {
      if (entries.size) throw new Error('OPERATION_IN_PROGRESS')
      storage(() => store.recoverInterrupted())
      changed()
    },
    async shutdown() {
      closing = true
      let error: unknown
      for (const entry of entries.values())
        if (!entry.executing) {
          try {
            cancelQueued(entry, 'APP_CLOSING')
          } catch (failure) {
            error = failure
            break
          }
        }
      await drain()
      if (error) throw error
      healthy()
    },
  }
}
