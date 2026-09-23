import { spawn, type ChildProcess } from 'node:child_process'
import {
  workerResultSchema,
  workerTaskSchema,
  type WorkerResult,
} from '@contextweave/worker-protocol'
import type { RuntimeSupervisor } from './runtime-supervisor'
import { terminateChild } from './runtime-supervisor'
import { ok, fail } from './result'
export function createWorkerService(runtime: RuntimeSupervisor, workerPath: string) {
  const workers = new Map<
    string,
    { child: ChildProcess; cancel: () => void; environmentId: string }
  >()
  return {
    async run(input: unknown) {
      const task = workerTaskSchema.parse(input)
      const session = runtime.session(task.environmentId)
      if (!session) return fail('ENVIRONMENT_NOT_RUNNING')
      if (
        [...workers.values()].some((worker) => worker.environmentId === task.environmentId) ||
        workers.has(task.taskId)
      )
        return fail('WORKER_BUSY')
      // The v0.1 smoke operation is bounded and cannot write to Renderer-supplied filesystem paths.
      if (task.input.screenshotPath || !/^https?:\/\//i.test(task.input.url))
        return fail('INVALID_TASK')
      const child = spawn(process.execPath, [workerPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      return new Promise<ReturnType<typeof ok<WorkerResult>> | ReturnType<typeof fail>>(
        (resolve) => {
          let output = '',
            settled = false
          const finish = (
            result: ReturnType<typeof ok<WorkerResult>> | ReturnType<typeof fail>,
          ) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            workers.delete(task.taskId)
            resolve(result)
          }
          const cancel = () => {
            terminateChild(child, 'SIGKILL')
            finish(fail('CANCELLED'))
          }
          const timer = setTimeout(() => {
            terminateChild(child, 'SIGKILL')
            finish(fail('WORKER_TIMEOUT'))
          }, task.input.timeoutMs + 5000)
          workers.set(task.taskId, { child, cancel, environmentId: task.environmentId })
          child.stdout?.on('data', (chunk: Buffer) => {
            output += String(chunk)
            if (output.length > 1024 * 1024) {
              terminateChild(child, 'SIGKILL')
              finish(fail('WORKER_OUTPUT_LIMIT'))
            }
          })
          child.stderr?.resume()
          child.once('error', () => finish(fail('WORKER_FAILED')))
          child.once('exit', () => {
            try {
              const result = workerResultSchema.parse(
                JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? ''),
              )
              if (result.taskId !== task.taskId || result.environmentId !== task.environmentId)
                throw new Error('WORKER_RESULT_MISMATCH')
              finish(ok(result))
            } catch {
              finish(fail('WORKER_FAILED'))
            }
          })
          child.stdin?.on('error', () => finish(fail('WORKER_FAILED')))
          child.stdin?.end(JSON.stringify({ task, controlPort: session.port }))
        },
      )
    },
    cancel(id: string) {
      const worker = workers.get(id)
      worker?.cancel()
      return ok(!!worker)
    },
    cancelEnvironment(id: string) {
      for (const worker of workers.values()) if (worker.environmentId === id) worker.cancel()
    },
    shutdown() {
      for (const worker of workers.values()) worker.cancel()
    },
  }
}
