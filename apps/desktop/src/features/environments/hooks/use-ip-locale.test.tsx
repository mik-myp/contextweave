// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpLocaleResult } from '@contextweave/contracts'
import { useIpLocale } from './use-ip-locale'
import { environmentService } from '../environment-service'
vi.mock('../environment-service', () => ({
  environmentService: { detectLocale: vi.fn(), cancelLocale: vi.fn().mockResolvedValue(true) },
}))
let hook: ReturnType<typeof useIpLocale>
function Fixture({
  connection = 'direct',
  proxyId = '',
}: {
  connection?: 'direct' | 'proxy'
  proxyId?: string
}) {
  hook = useIpLocale(connection, proxyId)
  return <output>{hook.busy ? 'loading' : (hook.error ?? hook.result?.ip ?? 'empty')}</output>
}
const result: IpLocaleResult = {
  ip: '203.0.113.42',
  language: 'en-US',
  timezone: 'America/New_York',
  countryCode: 'US',
  connection: 'direct',
  provider: 'ipwho.is',
  checkedAt: new Date().toISOString(),
}
let root: Root
let container: HTMLDivElement
let finish: (value: IpLocaleResult) => void
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.mocked(environmentService.detectLocale).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('IP region preview UI state', () => {
  it('makes no request on mount, prevents duplicate submits and displays a successful result', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <Fixture />
        </StrictMode>,
      ),
    )
    expect(environmentService.detectLocale).not.toHaveBeenCalled()
    await act(async () => {
      void hook.detect()
      void hook.detect()
    })
    expect(environmentService.detectLocale).toHaveBeenCalledOnce()
    expect(container.textContent).toBe('loading')
    await act(async () => finish(result))
    expect(container.textContent).toBe(result.ip)
  })
  it('cancels on route change and discards a late result even when the old route is reselected', async () => {
    await act(async () => root.render(<Fixture />))
    await act(async () => {
      void hook.detect()
    })
    await act(async () => root.render(<Fixture connection="proxy" proxyId="p1" />))
    expect(environmentService.cancelLocale).toHaveBeenCalledOnce()
    await act(async () => root.render(<Fixture />))
    await act(async () => finish(result))
    expect(hook.result).toBeUndefined()
    expect(hook.busy).toBe(false)
  })
  it('cancel never applies stale success; a missing proxy blocks detection', async () => {
    await act(async () => root.render(<Fixture connection="proxy" />))
    await act(async () => {
      await hook.detect()
    })
    expect(environmentService.detectLocale).not.toHaveBeenCalled()
    await act(async () => root.render(<Fixture />))
    await act(async () => {
      void hook.detect()
    })
    await act(async () => hook.cancel())
    await act(async () => finish(result))
    expect(hook.result).toBeUndefined()
  })
  it('shows errors without a result and cancels outstanding work on unmount', async () => {
    vi.mocked(environmentService.detectLocale).mockRejectedValueOnce(
      new Error('provider unavailable'),
    )
    await act(async () => root.render(<Fixture />))
    await act(async () => {
      await hook.detect()
    })
    expect(container.textContent).toBe('provider unavailable')
    await act(async () => {
      void hook.detect()
    })
    await act(async () => root.render(null))
    expect(environmentService.cancelLocale).toHaveBeenCalledOnce()
    await act(async () => finish(result))
  })
})
