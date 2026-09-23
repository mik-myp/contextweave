import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForCdp } from './runtime-supervisor'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('browser control readiness', () => {
  it('allows a cold browser to become ready after the old eight-second deadline', async () => {
    vi.useFakeTimers()
    const readyAt = Date.now() + 12000
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => {
        if (Date.now() < readyAt) throw new Error('connection refused')
        return new Response(JSON.stringify({ Browser: 'Chrome/153.0.0.0' }))
      }),
    )
    const ready = waitForCdp(9222, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(12000)
    expect(await ready).toBe('Chrome/153.0.0.0')
  })

  it('still fails after the bounded startup deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused')))
    const result = expect(waitForCdp(9222, new AbortController().signal)).rejects.toThrow(
      'CONTROL_TIMEOUT',
    )
    await vi.advanceTimersByTimeAsync(30000)
    await result
  })

  it('aborts an in-flight readiness request when startup is cancelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = options?.signal
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      ),
    )
    const controller = new AbortController()
    const result = expect(waitForCdp(9222, controller.signal)).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await result
  })
})
