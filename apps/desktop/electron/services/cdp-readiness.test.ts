import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserControl } from './browser-control'
import { controlFixture } from './fixtures/browser-control'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
  vi.useRealTimers()
})
async function fixture() {
  const control = await createBrowserControl(),
    browser = controlFixture()
  cleanup.push(control.close)
  control.attach(browser.child)
  browser.handle((message) => message.method === 'Browser.getVersion')
  return { control, browser }
}
describe('private browser control readiness', () => {
  it('allows a cold browser to acknowledge its private pipe after the old eight-second deadline', async () => {
    const { control, browser } = await fixture()
    vi.useFakeTimers()
    const ready = control.ready(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(12000)
    browser.emit({ id: browser.commands[0].id, result: { product: 'Chrome/153.0.0.0' } })
    expect(await ready).toBe('Chrome/153.0.0.0')
  })
  it('still fails after the bounded startup deadline and closes the broker', async () => {
    const { control } = await fixture()
    vi.useFakeTimers()
    const result = expect(control.ready(new AbortController().signal)).rejects.toThrow(
      'CONTROL_TIMEOUT',
    )
    await vi.advanceTimersByTimeAsync(30000)
    await result
    expect(() => control.lease()).toThrow('CONTROL_UNAVAILABLE')
  })
  it('cancels an in-flight pipe request immediately without HTTP polling', async () => {
    const { control } = await fixture()
    const controller = new AbortController()
    const result = expect(control.ready(controller.signal)).rejects.toThrow('CONTROL_CANCELLED')
    controller.abort()
    await result
  })
})
