import type { RegisterWorkerOutput } from './artifacts'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserControlLease } from './browser-control-access'
import {
  maxWorkerProtocolBytes,
  workerProcessRequestSchema,
  workerTaskSchema,
  type WorkerResult,
} from '@contextweave/worker-protocol'
import { ok, fail } from './result'
import { createWorkerOutput } from './worker-output'
import { createWorkerTransfer } from './worker-transfer'
import type { ForkWorker, WorkerProcess } from './worker-process'

type Outcome = ReturnType<typeof ok<WorkerResult>> | ReturnType<typeof fail>
export const workerStopGraceMs = 5000

export function createWorkerService(
  runtime: { session(id: string): unknown; leaseControl(id: string): BrowserControlLease },
  workerPath: string,
  outputRoot: string,
  forkWorker: ForkWorker,
  registerOutput: RegisterWorkerOutput,
  allocateOutput: typeof createWorkerOutput = createWorkerOutput,
) {
  const workers = new Map<
    string,
    { cancel(): void; environmentId: string; completion: Promise<Outcome> }
  >()
  return {
    async run(input: unknown): Promise<Outcome> {
      const task = workerTaskSchema.parse(input)
      if (!runtime.session(task.environmentId)) return fail('ENVIRONMENT_NOT_RUNNING')
      if (
        [...workers.values()].some((worker) => worker.environmentId === task.environmentId) ||
        workers.has(task.taskId)
      )
        return fail('WORKER_BUSY')
      let output: ReturnType<typeof createWorkerOutput>
      try {
        output = allocateOutput(outputRoot)
      } catch {
        return fail('WORKER_OUTPUT_UNAVAILABLE')
      }
      let lease: BrowserControlLease | undefined
      let child: WorkerProcess
      let request: ReturnType<typeof workerProcessRequestSchema.parse>
      try {
        lease = runtime.leaseControl(task.environmentId)
        request = workerProcessRequestSchema.parse({ task, control: lease.access })
        if (Buffer.byteLength(JSON.stringify(request)) > maxWorkerProtocolBytes)
          throw new Error('WORKER_INPUT_LIMIT')
        child = forkWorker(workerPath)
      } catch {
        lease?.revoke()
        try {
          await output.discard()
        } catch {
          return fail('WORKER_OUTPUT_CLEANUP_FAILED')
        }
        return fail('WORKER_FAILED')
      }
      let resolve!: (outcome: Outcome) => void
      const completion = new Promise<Outcome>((done) => {
        resolve = done
      })
      let resolved = false
      let exitNotified = false
      let exited = false
      let spawned = false
      let finished = false
      let stopResult: ReturnType<typeof fail> | undefined
      let grace: ReturnType<typeof setTimeout> | undefined
      const settle = (outcome: Outcome) => {
        if (resolved) return
        resolved = true
        resolve(outcome)
      }
      const startGrace = () => {
        grace ??= setTimeout(() => {
          // A response deadline does NOT release ownership or close an in-flight FD.
          const failure = fail(exited ? 'WORKER_OUTPUT_CLEANUP_FAILED' : 'WORKER_STOP_FAILED')
          stopResult ??= failure
          settle(failure)
        }, workerStopGraceMs)
      }
      const attemptStop = () => {
        if (!spawned || exitNotified) return
        // Even true only confirms a stop request. The actual exit is authoritative.
        try {
          child.kill()
        } catch {
          /* Keep ownership; the grace deadline reports failure. */
        }
      }
      const stop = (code: string) => {
        if (finished) return
        stopResult ??= fail(code)
        transfer.stop()
        lease?.revoke()
        clearTimeout(timer)
        startGrace()
        attemptStop()
      }
      const transfer = createWorkerTransfer(
        request,
        output,
        (message) => child.postMessage(message),
        stop,
      )
      const timer = setTimeout(() => stop('WORKER_TIMEOUT'), task.input.timeoutMs + 5000)
      const cancel = () => stop('CANCELLED')
      workers.set(task.taskId, { cancel, environmentId: task.environmentId, completion })
      child.once('spawn', () => {
        spawned = true
        if (stopResult) attemptStop()
      })
      child.on('message', (message) => transfer.receive(message))
      // UtilityProcess errors include a diagnostic report; never retain or serialize it.
      child.once('error', () => stop('WORKER_FAILED'))
      child.once('exit', (code) => {
        exitNotified = true
        transfer.stop()
        lease?.revoke()
        clearTimeout(timer)
        startGrace()
        void (async () => {
          let outcome: Outcome = stopResult ?? fail('WORKER_FAILED')
          let preserveOutput = false
          try {
            // Electron 44 may notify JS of process.exit before the OS process is gone.
            // Keep the slot through that gap and beyond the public response deadline.
            while (!child.hasExited()) await delay(resolved ? 250 : 10, undefined, { ref: false })
            exited = true
            await output.close()
            if (!stopResult && code === 0 && transfer.result) {
              const result = transfer.result
              if (result.ok) {
                // Unexpected registrar exceptions must preserve any possibly committed output.
                preserveOutput = true
                const registered = registerOutput(task, output)
                if (registered.ok)
                  outcome = ok({
                    ...result,
                    artifactId: registered.artifactId,
                    screenshotPath: registered.screenshotPath,
                  })
                else {
                  preserveOutput = registered.preserve
                  outcome = fail(registered.code)
                }
              } else outcome = ok(result)
            }
          } catch {
            outcome = fail(
              preserveOutput ? 'WORKER_OUTPUT_REGISTRATION_UNCONFIRMED' : 'WORKER_OUTPUT_FAILED',
            )
          }
          if (!preserveOutput && (!outcome.ok || !outcome.data.ok)) {
            try {
              await output.discard()
            } catch {
              outcome = fail('WORKER_OUTPUT_CLEANUP_FAILED')
            }
          }
          finished = true
          clearTimeout(grace)
          workers.delete(task.taskId)
          settle(outcome)
        })()
      })
      return completion
    },
    cancel(id: string) {
      const worker = workers.get(id)
      worker?.cancel()
      return ok(!!worker)
    },
    cancelEnvironment(id: string) {
      for (const worker of workers.values()) if (worker.environmentId === id) worker.cancel()
    },
    async shutdown() {
      const owned = [...workers.values()]
      for (const worker of owned) worker.cancel()
      await Promise.all(owned.map((worker) => worker.completion))
    },
  }
}
