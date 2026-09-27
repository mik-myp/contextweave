import { artifactRecordSchema, artifactQuerySchema, type DataDomain } from '@contextweave/contracts'
import type { ArtifactRepository } from '@contextweave/storage'
import type { WorkerTask } from '@contextweave/worker-protocol'
import type { createWorkerOutput } from './worker-output'

export type OutputRegistration =
  | { ok: true; artifactId: string; screenshotPath: string }
  | { ok: false; code: string; preserve: boolean }
export type RegisterWorkerOutput = (
  task: WorkerTask,
  output: ReturnType<typeof createWorkerOutput>,
) => OutputRegistration

export function createArtifactService(
  repository: Pick<ArtifactRepository, 'registerArtifact' | 'pageArtifacts'>,
  changed: (domains: DataDomain[]) => void,
) {
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
    try {
      changed(['storage'])
    } catch {
      /* A dropped notification must not undo a committed result. */
    }
    return { ok: true, artifactId: record.artifactId, screenshotPath: output.screenshotPath }
  }
  return {
    register,
    page: (input: unknown) => repository.pageArtifacts(artifactQuerySchema.parse(input)),
  }
}
