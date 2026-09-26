import { setTimeout as delay } from 'node:timers/promises'

/** One post-spawn budget, not a new full timeout for every initialization phase. */
export function createStartupBudget(parent: AbortSignal, timeoutMs = 30000) {
  const controller = new AbortController()
  const deadline = performance.now() + timeoutMs
  let timedOut = false
  const expire = () => {
    timedOut = true
    controller.abort(new Error('CONTROL_TIMEOUT'))
  }
  const timer = setTimeout(expire, timeoutMs)
  const cancel = () => {
    clearTimeout(timer)
    controller.abort(parent.reason)
  }
  parent.addEventListener('abort', cancel, { once: true })
  if (parent.aborted) cancel()
  return {
    signal: controller.signal,
    deadline,
    throwIfAborted() {
      // A busy event loop may not have dispatched the deadline's timer yet.
      if (!controller.signal.aborted && performance.now() >= deadline) expire()
      controller.signal.throwIfAborted()
    },
    get timedOut() {
      return timedOut
    },
    abort: () => {
      clearTimeout(timer)
      controller.abort()
    },
    dispose() {
      clearTimeout(timer)
      parent.removeEventListener('abort', cancel)
    },
  }
}

export async function confirmProcessIdentity(options: {
  pid: number
  signal: AbortSignal
  alive(): boolean
  probe(pid: number, signal: AbortSignal): Promise<string | undefined>
}): Promise<string> {
  for (;;) {
    options.signal.throwIfAborted()
    if (!options.alive()) throw new Error('START_FAILED')
    const identity = await options.probe(options.pid, options.signal)
    options.signal.throwIfAborted()
    if (!options.alive()) throw new Error('START_FAILED')
    if (identity) return identity
    // Retry only the read-only query; the same owned browser is never restarted.
    await delay(100, undefined, { signal: options.signal })
  }
}
