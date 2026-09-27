import { z } from 'zod'
import {
  assertWorkspaceContext,
  commandRequestIdSchema,
  commandEnvironmentIdSchema,
  commandRevisionSchema,
  environmentCommandKindSchema,
  environmentCommandRequestSchema,
  environmentCommandReceiptSchema,
  isEnvironmentCommandActive,
  workspaceContextSchema,
  type EnvironmentCommandReceipt,
  type EnvironmentCommandKind,
  type WorkspaceContext,
} from '@contextweave/contracts'
import type { WorkspaceApi } from '@/features/workspaces/workspace-api'
import { errorMessage } from '@/shared/lib/error-message'

type WithoutId<T> = T extends unknown ? Omit<T, 'requestId'> : never
export type NewEnvironmentCommand = WithoutId<z.input<typeof environmentCommandRequestSchema>>
const pendingSchema = z
  .strictObject({
    requestId: commandRequestIdSchema,
    kind: environmentCommandKindSchema,
    environmentId: commandEnvironmentIdSchema.nullable(),
    expectedRevision: commandRevisionSchema.nullable(),
    createdAt: z.string().datetime(),
  })
  .refine((entry) =>
    entry.kind === 'create'
      ? entry.environmentId === null && entry.expectedRevision === null
      : entry.environmentId !== null && entry.expectedRevision !== null,
  )
export type PendingEnvironmentCommand = z.infer<typeof pendingSchema>
export const commandSlot = (kind: EnvironmentCommandKind, id: string | null) =>
  kind === 'create' ? 'create' : `${kind}:${id}`
const journalSchema = workspaceContextSchema
  .extend({ version: z.literal(1), entries: z.array(pendingSchema).max(200) })
  .refine(
    ({ entries }) =>
      new Set(entries.map((entry) => entry.requestId)).size === entries.length &&
      new Set(entries.map((entry) => commandSlot(entry.kind, entry.environmentId))).size ===
        entries.length,
  )
type Snapshot = { entries: readonly Readonly<PendingEnvironmentCommand>[]; problem?: string }
type Observation = { state: 'found'; receipt: EnvironmentCommandReceipt } | { state: 'not-found' }
export class PendingEnvironmentCommandError extends Error {
  constructor(readonly requestId: string) {
    super(errorMessage('COMMAND_UNCONFIRMED'))
  }
}

/** Client tracking only; the queue, execution authority and immutable facts remain in Main. */
export function createEnvironmentCommandClient(options: {
  context: WorkspaceContext
  api: Pick<WorkspaceApi['environment'], 'submitCommand' | 'commandReceipt'>
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  now?: () => number
}) {
  const context = workspaceContextSchema.parse(options.context)
  const key = `contextweave:environment-commands:v1:${context.workspaceId}`
  const now = options.now ?? (() => performance.now())
  let snapshot: Snapshot = { entries: [] }
  const listeners = new Set<() => void>(),
    controllers = new Set<AbortController>()
  const observations = new Map<string, Observation>()
  const publish = (next: Snapshot) => {
    snapshot = Object.freeze({
      ...next,
      entries: Object.freeze(next.entries.map((entry) => Object.freeze({ ...entry }))),
    })
    for (const listener of listeners) listener()
  }
  try {
    if (!options.storage) throw new Error('TRACKING_UNAVAILABLE')
    const raw = options.storage.getItem(key)
    if (raw !== null) {
      if (raw.length > 262144) throw new Error('TRACKING_INVALID')
      const journal = journalSchema.parse(JSON.parse(raw))
      assertWorkspaceContext(context, { workspaceId: journal.workspaceId })
      publish({ entries: journal.entries })
    }
  } catch {
    publish({ entries: [], problem: 'COMMAND_TRACKING_UNAVAILABLE' })
  }
  function persist(entries: readonly PendingEnvironmentCommand[]) {
    try {
      if (!options.storage) throw new Error('TRACKING_UNAVAILABLE')
      const journal = journalSchema.parse({ ...context, version: 1, entries })
      options.storage.setItem(key, JSON.stringify(journal))
      publish({ entries: journal.entries })
    } catch {
      publish({ ...snapshot, problem: 'COMMAND_TRACKING_UNAVAILABLE' })
      throw new Error(errorMessage('COMMAND_TRACKING_UNAVAILABLE'))
    }
  }
  function remember(requestId: string, observation: Observation) {
    // A concurrent acknowledgement or reset may have removed the journal entry.
    if (snapshot.entries.some((entry) => entry.requestId === requestId))
      observations.set(requestId, observation)
  }
  function remove(id: string) {
    persist(snapshot.entries.filter((entry) => entry.requestId !== id))
    observations.delete(id)
  }
  function bounded<T>(promise: Promise<T>, signal: AbortSignal, milliseconds = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const finish = (action: () => void) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        action()
      }
      const aborted = () => finish(() => reject(new Error('OBSERVATION_ABORTED')))
      const timer = setTimeout(
        () => finish(() => reject(new Error('OBSERVATION_TIMEOUT'))),
        Math.max(1, milliseconds),
      )
      signal.addEventListener('abort', aborted, { once: true })
      // Consume late settlement but never resend an effect or change tracking from it.
      void promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      )
      if (signal.aborted) aborted()
    })
  }
  function validate(entry: PendingEnvironmentCommand, input: unknown) {
    const receipt = environmentCommandReceiptSchema.parse(input)
    assertWorkspaceContext(context, { workspaceId: receipt.workspaceId })
    if (
      receipt.requestId !== entry.requestId ||
      receipt.kind !== entry.kind ||
      receipt.expectedRevision !== entry.expectedRevision ||
      (entry.environmentId !== null && receipt.environmentId !== entry.environmentId)
    )
      throw new Error('COMMAND_RECEIPT_MISMATCH')
    return receipt
  }
  async function lookup(
    entry: PendingEnvironmentCommand,
    signal: AbortSignal,
    milliseconds = 3000,
  ): Promise<Observation> {
    const result = await bounded(options.api.commandReceipt(entry.requestId), signal, milliseconds)
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') return { state: 'not-found' }
      throw new Error(errorMessage(result.code))
    }
    return { state: 'found', receipt: validate(entry, result.data) }
  }
  async function execute(input: NewEnvironmentCommand): Promise<EnvironmentCommandReceipt>
  async function execute<T>(
    input: NewEnvironmentCommand,
    readSuccess: (receipt: EnvironmentCommandReceipt) => Promise<T>,
  ): Promise<T>
  async function execute<T>(
    input: NewEnvironmentCommand,
    readSuccess?: (receipt: EnvironmentCommandReceipt) => Promise<T>,
  ): Promise<EnvironmentCommandReceipt | T> {
    if (snapshot.problem) throw new Error(errorMessage(snapshot.problem))
    const request = environmentCommandRequestSchema.parse({
      ...input,
      requestId: crypto.randomUUID(),
    })
    const target =
      request.kind === 'create' ? null : request.kind === 'update' ? request.input : request
    const slot = commandSlot(request.kind, target?.environmentId ?? null)
    const previous = snapshot.entries.find(
      (entry) => commandSlot(entry.kind, entry.environmentId) === slot,
    )
    if (previous) throw new PendingEnvironmentCommandError(previous.requestId)
    if (snapshot.entries.length >= 200) throw new Error(errorMessage('COMMAND_TRACKING_LIMIT'))
    const entry = pendingSchema.parse({
      requestId: request.requestId,
      kind: request.kind,
      environmentId: target?.environmentId ?? null,
      expectedRevision: target?.expectedRevision ?? null,
      createdAt: new Date().toISOString(),
    })
    persist([...snapshot.entries, entry]) // Fail closed before the only side-effect request.
    const controller = new AbortController(),
      deadline = now() + 30000
    controllers.add(controller)
    let receipt: EnvironmentCommandReceipt | undefined
    try {
      try {
        const response = await bounded(options.api.submitCommand(request), controller.signal)
        if (response.ok) receipt = validate(entry, response.data)
      } catch {
        /* Lost/mismatched reply: only query the original request ID below. */
      }
      for (;;) {
        if (controller.signal.aborted || now() >= deadline)
          throw new PendingEnvironmentCommandError(entry.requestId)
        if (!receipt) {
          const observation = await lookup(
            entry,
            controller.signal,
            Math.min(3000, deadline - now()),
          )
          remember(entry.requestId, observation)
          if (observation.state === 'not-found')
            throw new PendingEnvironmentCommandError(entry.requestId)
          receipt = observation.receipt
        }
        if (!isEnvironmentCommandActive(receipt.status)) break
        await bounded(
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
          controller.signal,
          Math.min(3000, deadline - now()),
        )
        receipt = undefined
      }
      remember(entry.requestId, { state: 'found', receipt })
      if (receipt.status === 'unknown') throw new PendingEnvironmentCommandError(entry.requestId)
      if (receipt.status !== 'succeeded') {
        remove(entry.requestId)
        throw new Error(errorMessage(receipt.errorCode ?? 'COMMAND_FAILED'))
      }
      // A lost follow-up read is still an unresolved UI delivery. Keep the original
      // identity until the caller has the public state it needs; otherwise a failed
      // detail read after creation would enable a second create with a fresh ID.
      const confirmed = receipt
      const value = readSuccess
        ? await bounded(
            Promise.resolve().then(() => readSuccess(confirmed)),
            controller.signal,
            Math.min(3000, deadline - now()),
          )
        : confirmed
      remove(entry.requestId)
      return value
    } catch (error) {
      // A retained index means the effect is not safely resolved from this caller's point of view.
      if (snapshot.entries.some((item) => item.requestId === entry.requestId))
        throw new PendingEnvironmentCommandError(entry.requestId)
      throw error
    } finally {
      controllers.delete(controller)
    }
  }
  return {
    execute,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stopObserving: () => {
      for (const controller of controllers) controller.abort()
    },
    async check(requestId: string) {
      const entry = snapshot.entries.find((item) => item.requestId === requestId)
      if (!entry) throw new Error(errorMessage('COMMAND_LOOKUP_REQUIRED'))
      const controller = new AbortController()
      controllers.add(controller)
      try {
        const observation = await lookup(entry, controller.signal)
        remember(entry.requestId, observation)
        return observation
      } catch {
        // Transport/schema exceptions may contain payloads or native paths.
        throw new Error(errorMessage('COMMAND_UNCONFIRMED'))
      } finally {
        controllers.delete(controller)
      }
    },
    acknowledge(requestId: string) {
      const observation = observations.get(requestId)
      if (!observation) throw new Error(errorMessage('COMMAND_LOOKUP_REQUIRED'))
      if (observation.state === 'found' && isEnvironmentCommandActive(observation.receipt.status))
        throw new Error(errorMessage('OPERATION_IN_PROGRESS'))
      // Explicit user acknowledgement only. Does not modify or delete any authoritative receipt.
      remove(requestId)
    },
    resetInvalidIndex() {
      if (!snapshot.problem) throw new Error('COMMAND_LOOKUP_REQUIRED')
      persist([])
      observations.clear()
    },
  }
}
export type EnvironmentCommandClient = ReturnType<typeof createEnvironmentCommandClient>
