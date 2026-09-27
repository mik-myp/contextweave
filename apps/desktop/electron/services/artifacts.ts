import { randomUUID } from 'node:crypto'
import {
  artifactRecordSchema,
  artifactQuerySchema,
  artifactBudgetUpdateSchema,
  type DataDomain,
} from '@contextweave/contracts'
import type { ArtifactRepository } from '@contextweave/storage'
import type { WorkerTask } from '@contextweave/worker-protocol'
import { createWorkerOutput } from './worker-output'

type Output = ReturnType<typeof createWorkerOutput>
export type WorkerOutputAllocation =
  { ok: true; output: Output } | { ok: false; code: string; output?: Output }
export interface WorkerOutputStore {
  allocate(task: WorkerTask): WorkerOutputAllocation
  register: RegisterWorkerOutput
  discard(output: Output): Promise<void>
}

export type OutputRegistration =
  | { ok: true; artifactId: string; screenshotPath: string }
  | { ok: false; code: string; preserve: boolean }
export type RegisterWorkerOutput = (
  task: WorkerTask,
  output: ReturnType<typeof createWorkerOutput>,
) => OutputRegistration

export function createArtifactService(
  repository: Pick<
    ArtifactRepository,
    | 'registerArtifact'
    | 'pageArtifacts'
    | 'budget'
    | 'updateBudget'
    | 'reserve'
    | 'bindAllocation'
    | 'releaseReservation'
  >,
  changed: (domains: DataDomain[]) => void,
  outputRoot: string,
  allocateOutput: typeof createWorkerOutput = createWorkerOutput,
) {
  const notify = () => {
    try {
      changed(['storage'])
    } catch {
      /* A dropped notification cannot undo durable state. */
    }
  }
  const allocate = (task: WorkerTask): WorkerOutputAllocation => {
    const artifactId = randomUUID()
    try {
      repository.reserve({
        artifactId,
        environmentId: task.environmentId,
        taskId: task.taskId,
        reservedAt: new Date().toISOString(),
      })
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof Error && error.message === 'ARTIFACT_BUDGET_EXCEEDED'
            ? 'ARTIFACT_BUDGET_EXCEEDED'
            : 'WORKER_OUTPUT_RESERVATION_UNCONFIRMED',
      }
    }
    notify()
    let output: Output | undefined
    try {
      output = allocateOutput(outputRoot, undefined, artifactId)
      if (output.artifactId !== artifactId) throw new Error('WORKER_OUTPUT_INVALID')
      repository.bindAllocation(output.allocation())
      return { ok: true, output }
    } catch {
      // No Worker has been launched. Retain the intent and empty allocation, and let
      // the caller close its descriptor; an uncertain bind must not be retried blindly.
      return { ok: false, code: 'WORKER_OUTPUT_RESERVATION_UNCONFIRMED', output }
    }
  }
  const register: RegisterWorkerOutput = (task, output) => {
    let record
    try {
      record = artifactRecordSchema.parse({
        ...output.inspect(),
        environmentId: task.environmentId,
        taskId: task.taskId,
        completedAt: new Date().toISOString(),
      })
    } catch {
      return { ok: false, code: 'WORKER_OUTPUT_INVALID', preserve: false }
    }
    try {
      repository.registerArtifact(record)
    } catch {
      // Once registration was attempted, never delete: a lost COMMIT response can
      // leave a durable row. The read-only inventory reconciles it after restart.
      return { ok: false, code: 'WORKER_OUTPUT_REGISTRATION_UNCONFIRMED', preserve: true }
    }
    notify()
    return { ok: true, artifactId: record.artifactId, screenshotPath: output.screenshotPath }
  }
  return {
    allocate,
    register,
    async discard(output: Output) {
      await output.discard()
      // A stopped response is insufficient: this only runs after strict output cleanup.
      repository.releaseReservation(output.artifactId)
      notify()
    },
    budget: () => {
      try {
        return repository.budget()
      } catch {
        throw new Error('ARTIFACT_STORAGE_UNAVAILABLE')
      }
    },
    updateBudget(input: unknown) {
      const change = artifactBudgetUpdateSchema.parse(input)
      try {
        const result = repository.updateBudget(change)
        notify()
        return result
      } catch (error) {
        if (
          error instanceof Error &&
          ['ARTIFACT_BUDGET_CONFLICT', 'ARTIFACT_BUDGET_REVISION_LIMIT'].includes(error.message)
        )
          throw error
        // eslint-disable-next-line preserve-caught-error -- Raw SQLite/filesystem failures may contain private paths or statement data.
        throw new Error('ARTIFACT_BUDGET_UPDATE_UNCONFIRMED')
      }
    },
    page: (input: unknown) => repository.pageArtifacts(artifactQuerySchema.parse(input)),
  }
}
