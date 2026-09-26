import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmProcessIdentity, createStartupBudget } from './runtime-startup'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('one bounded browser startup', () => {
  it('expires exactly once at the shared 30 second deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const budget = createStartupBudget(new AbortController().signal)
    expect(budget.deadline).toBe(performance.now() + 30000)
    await vi.advanceTimersByTimeAsync(29999)
    expect(budget.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(budget.signal.reason).toEqual(new Error('CONTROL_TIMEOUT'))
    expect(budget.timedOut).toBe(true)
    budget.dispose()
  })
  it('rejects an elapsed monotonic deadline before its timer has been dispatched', () => {
    const budget = createStartupBudget(new AbortController().signal)
    vi.spyOn(performance, 'now').mockReturnValue(budget.deadline + 1)
    expect(() => budget.throwIfAborted()).toThrow('CONTROL_TIMEOUT')
    expect(budget.timedOut).toBe(true)
    budget.dispose()
  })
  it('disposes successful startup without aborting its long-lived settings connection', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const budget = createStartupBudget(parent.signal)
    budget.dispose()
    parent.abort()
    await vi.advanceTimersByTimeAsync(60000)
    expect(budget.signal.aborted).toBe(false)
    expect(budget.timedOut).toBe(false)
  })
  it.each(['before', 'after'] as const)(
    'preserves parent cancellation %s construction',
    async (when) => {
      vi.useFakeTimers()
      const parent = new AbortController()
      if (when === 'before') parent.abort(new Error('cancelled'))
      const budget = createStartupBudget(parent.signal)
      if (when === 'after') parent.abort(new Error('cancelled'))
      expect(budget.signal.reason).toEqual(new Error('cancelled'))
      await vi.advanceTimersByTimeAsync(60000)
      expect(budget.timedOut).toBe(false)
      budget.dispose()
    },
  )
  it('does not turn another startup failure into a timeout during cleanup', async () => {
    vi.useFakeTimers()
    const budget = createStartupBudget(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(29000)
    budget.dispose()
    budget.abort()
    await vi.advanceTimersByTimeAsync(5000)
    expect(budget.signal.aborted).toBe(true)
    expect(budget.timedOut).toBe(false)
  })
})

describe('owned child identity confirmation', () => {
  it('retries only a read-only query of the same live child after an unknown result', async () => {
    const probe = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue('os:start')
    const signal = new AbortController().signal
    expect(await confirmProcessIdentity({ pid: 123, signal, alive: () => true, probe })).toBe(
      'os:start',
    )
    expect(probe.mock.calls).toEqual([
      [123, signal],
      [123, signal],
    ])
  })
  it('never accepts an identity after the child exited while its query was pending', async () => {
    let alive = true
    await expect(
      confirmProcessIdentity({
        pid: 123,
        signal: new AbortController().signal,
        alive: () => alive,
        probe: async () => {
          alive = false
          return 'os:start'
        },
      }),
    ).rejects.toThrow('START_FAILED')
  })
  it('does not query a child already known to have exited', async () => {
    const probe = vi.fn()
    await expect(
      confirmProcessIdentity({
        pid: 123,
        signal: new AbortController().signal,
        alive: () => false,
        probe,
      }),
    ).rejects.toThrow('START_FAILED')
    expect(probe).not.toHaveBeenCalled()
  })
  it('aborts an unavailable identity within the existing startup budget', async () => {
    vi.useFakeTimers()
    const budget = createStartupBudget(new AbortController().signal)
    const probe = vi.fn(async () => undefined)
    const result = confirmProcessIdentity({
      pid: 123,
      signal: budget.signal,
      alive: () => true,
      probe,
    })
    const rejected = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expect(budget.timedOut).toBe(true)
    budget.dispose()
  })
  it('rejects a late successful response after cancellation', async () => {
    const controller = new AbortController()
    await expect(
      confirmProcessIdentity({
        pid: 123,
        signal: controller.signal,
        alive: () => true,
        probe: async () => {
          controller.abort(new Error('cancelled'))
          return 'os:start'
        },
      }),
    ).rejects.toThrow('cancelled')
  })
})
