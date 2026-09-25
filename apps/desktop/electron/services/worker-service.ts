import { spawn, type ChildProcess } from 'node:child_process'
import {
  maxWorkerProtocolBytes,
  workerProcessResultSchema,
  workerProcessRequestSchema,
  workerTaskSchema,
  type WorkerResult,
} from '@contextweave/worker-protocol'
import { terminateChild } from './runtime-supervisor'
import { ok, fail } from './result'
import { createWorkerOutput } from './worker-output'
export function createWorkerService(
  runtime: { session(id: string): { port: number } | undefined },
  workerPath: string,
  outputRoot: string,
) {
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
      const request = workerProcessRequestSchema.parse({ task, controlPort: session.port })
      let outputFile: ReturnType<typeof createWorkerOutput>
      try {
        outputFile = createWorkerOutput(outputRoot)
      } catch {
        return fail('WORKER_OUTPUT_UNAVAILABLE')
      }
      let child: ChildProcess
      try {
        child = spawn(process.execPath, [workerPath], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          // Descriptor 3 is the only screenshot destination the worker receives.
          stdio: ['pipe', 'pipe', 'pipe', outputFile.descriptor],
          windowsHide: true,
        })
      } catch {
        outputFile.discard()
        return fail('WORKER_FAILED')
      } finally {
        outputFile.closeDescriptor()
      }
      return new Promise<ReturnType<typeof ok<WorkerResult>> | ReturnType<typeof fail>>(
        (resolve) => {
          const output: Buffer[] = []
          let outputBytes = 0,
            settled = false
          let stopResult: ReturnType<typeof fail> | undefined
          const finish = (
            result: ReturnType<typeof ok<WorkerResult>> | ReturnType<typeof fail>,
          ) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            workers.delete(task.taskId)
            if (!result.ok || !result.data.ok) {
              try {
                outputFile.discard()
              } catch {
                resolve(fail('WORKER_OUTPUT_CLEANUP_FAILED'))
                return
              }
            }
            resolve(result)
          }
          const stop = (code: string) => {
            if (settled || stopResult) return
            stopResult = fail(code)
            terminateChild(child, 'SIGKILL')
            // Retain ownership until close: the child may still hold the output fd on Windows.
          }
          const cancel = () => stop('CANCELLED')
          const timer = setTimeout(() => stop('WORKER_TIMEOUT'), task.input.timeoutMs + 5000)
          workers.set(task.taskId, { child, cancel, environmentId: task.environmentId })
          child.stdout?.on('data', (chunk: Buffer) => {
            if (stopResult) return
            outputBytes += chunk.length
            if (outputBytes > maxWorkerProtocolBytes) {
              stop('WORKER_OUTPUT_LIMIT')
              return
            }
            output.push(Buffer.from(chunk))
          })
          child.stderr?.resume()
          child.once('error', () => {
            stopResult ??= fail('WORKER_FAILED')
          })
          child.once('close', (code) => {
            if (settled) return
            if (stopResult) {
              finish(stopResult)
              return
            }
            if (code !== 0) {
              finish(fail('WORKER_FAILED'))
              return
            }
            try {
              const result = workerProcessResultSchema.parse(
                JSON.parse(Buffer.concat(output).toString('utf8').trim()),
              )
              if (result.taskId !== task.taskId || result.environmentId !== task.environmentId)
                throw new Error('WORKER_RESULT_MISMATCH')
              finish(ok(result.ok ? { ...result, screenshotPath: outputFile.validate() } : result))
            } catch {
              finish(fail('WORKER_FAILED'))
            }
          })
          child.stdin?.on('error', () => stop('WORKER_FAILED'))
          child.stdin?.end(JSON.stringify(request))
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
