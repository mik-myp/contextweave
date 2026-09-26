import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserControl } from './browser-control'
import { controlFixture } from './fixtures/browser-control'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.useRealTimers()
})
async function fixture() {
  const browser = controlFixture()
  const control = await createBrowserControl()
  cleanups.push(control.close)
  control.attach(browser.child)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  return { browser, control }
}

describe('private pipe cold startup readiness', () => {
  it('waits for a browser session after late version discovery without restarting the 30 second budget', async () => {
    const { browser, control } = await fixture()
    browser.handle((command) => {
      if (command.method === 'Browser.getVersion') {
        setTimeout(
          () => browser.emit({ id: command.id, result: { product: 'Chrome/123.0.0.1' } }),
          20000,
        )
        return true
      }
      if (command.method === 'Target.attachToBrowserTarget') {
        setTimeout(
          () => browser.emit({ id: command.id, result: { sessionId: 'startup-root' } }),
          6000,
        )
        return true
      }
      return false
    })
    let ready = false
    const result = control.ready(new AbortController().signal).then((version) => {
      ready = true
      return version
    })
    await vi.advanceTimersByTimeAsync(25000)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe('Chrome/123.0.0.1')
    expect(browser.commands.map(({ method }) => method)).toEqual([
      'Browser.getVersion',
      'Target.attachToBrowserTarget',
      'Target.detachFromTarget',
    ])
    expect(browser.commands[2].params).toEqual({ sessionId: 'startup-root' })
  })
  it.each(['Browser.getVersion', 'Target.attachToBrowserTarget', 'Target.detachFromTarget'])(
    'still fails within 30 seconds if %s never completes',
    async (method) => {
      const { browser, control } = await fixture()
      browser.handle((command) => {
        if (command.method === method) return true
        if (command.method === 'Browser.getVersion') {
          setTimeout(
            () => browser.emit({ id: command.id, result: { product: 'Chrome/123.0.0.1' } }),
            20000,
          )
          return true
        }
        return false
      })
      const failed = expect(control.ready(new AbortController().signal)).rejects.toThrow(
        'CONTROL_TIMEOUT',
      )
      await vi.advanceTimersByTimeAsync(30000)
      await failed
      expect(browser.input.destroyed).toBe(true)
      expect(browser.output.destroyed).toBe(true)
      expect(() => control.lease()).toThrow('CONTROL_UNAVAILABLE')
    },
  )
  it('cancels a pending startup root and closes the pipe without exposing an orphan session', async () => {
    const { browser, control } = await fixture()
    browser.handle((command) => command.method === 'Target.attachToBrowserTarget')
    const controller = new AbortController()
    const failed = expect(control.ready(controller.signal)).rejects.toThrow('CONTROL_CANCELLED')
    await vi.advanceTimersByTimeAsync(0)
    expect(browser.commands.at(-1)?.method).toBe('Target.attachToBrowserTarget')
    controller.abort()
    await failed
    expect(browser.output.destroyed).toBe(true)
    expect(() => control.lease()).toThrow('CONTROL_UNAVAILABLE')
  })
})
