import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { createServer } from 'node:net'
import { once } from 'node:events'
import type { KernelCapabilities } from '@contextweave/contracts'
import { createControlPipe, type ControlPipe } from './browser-control-pipe'
import { checkKernelCapabilities } from './kernel-capability-checks'

function exited(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(value)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
  })
}

/** A disposable, sandboxed Chromium profile with a private pipe and a deny-all local proxy. */
export async function probeKernelCapabilities(
  executable: string,
  capabilities: KernelCapabilities,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const root = await mkdtemp(join(tmpdir(), 'contextweave-kernel-probe-'))
  const denyProxy = createServer((socket) => socket.destroy())
  let child: ChildProcess | undefined, pipe: ControlPipe | undefined
  let clean = true
  let result: Awaited<ReturnType<typeof checkKernelCapabilities>> | undefined
  let errorCode: string | undefined
  try {
    denyProxy.listen(0, '127.0.0.1')
    await once(denyProxy, 'listening')
    const address = denyProxy.address()
    if (!address || typeof address === 'string') throw new Error('KERNEL_PROBE_FAILED')
    const file = join(root, 'fixture.txt')
    await writeFile(file, 'ContextWeave offline capability probe', { mode: 0o600 })
    signal.throwIfAborted()
    child = spawn(
      executable,
      [
        `--user-data-dir=${join(root, 'profile')}`,
        '--headless=new',
        '--no-startup-window',
        '--remote-debugging-pipe',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-extensions',
        '--metrics-recording-only',
        '--disable-features=MediaRouter',
        `--proxy-server=http://127.0.0.1:${address.port}`,
        '--proxy-bypass-list=<-loopback>',
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    const failure = new AbortController()
    const abort = () => {
      failure.abort()
      pipe?.close()
    }
    child.once('error', abort)
    child.once('exit', abort)
    const input = child.stdio[3],
      output = child.stdio[4]
    if (!(input instanceof Writable) || !(output instanceof Readable))
      throw new Error('KERNEL_PROBE_FAILED')
    pipe = createControlPipe(input, output)
    const activePipe = pipe
    const deadline = AbortSignal.any([signal, failure.signal, AbortSignal.timeout(20_000)])
    result = await checkKernelCapabilities(
      capabilities,
      async (method, params, sessionId) => {
        const response = await activePipe.send(method, params, sessionId, {
          signal: deadline,
          timeoutMs: 3000,
        })
        if (response.error) throw new Error('KERNEL_PROBE_FAILED')
        return response.result ?? {}
      },
      file,
      deadline,
    )
  } catch {
    // CDP and spawn errors can contain local paths. Only expose a fixed public code.
    errorCode = signal.aborted ? 'CANCELLED' : 'KERNEL_PROBE_FAILED'
  } finally {
    if (child) {
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        child.kill('SIGTERM')
        if (!(await exited(child, 1500))) {
          child.kill('SIGKILL')
          clean = await exited(child, 1500)
        }
      }
    }
    pipe?.close()
    denyProxy.close()
    if (clean) {
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      } catch {
        errorCode = 'KERNEL_PROBE_CLEANUP_FAILED'
      }
    } else errorCode = 'KERNEL_PROBE_CLEANUP_FAILED' // Preserve the in-use profile, fail closed.
  }
  if (errorCode || !result) throw new Error(errorCode ?? 'KERNEL_PROBE_FAILED')
  return result
}
