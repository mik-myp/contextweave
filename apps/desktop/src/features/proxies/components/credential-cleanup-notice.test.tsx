// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialCleanupNotice } from './credential-cleanup-notice'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => (key === 'proxy.cleanup.description' ? `${key} {count}` : key),
  }),
}))
const empty = { pendingCount: 0, temporaryFilesPending: false }
const cleanupStatus = vi.fn(async () => ({ ok: true as const, data: empty }))
const retryCleanup = vi.fn(async () => ({ ok: true as const, data: empty }))
let container: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  cleanupStatus.mockReset().mockResolvedValue({ ok: true, data: empty })
  retryCleanup.mockReset().mockResolvedValue({ ok: true, data: empty })
  Object.defineProperty(window, 'contextweave', {
    configurable: true,
    value: { proxy: { cleanupStatus, retryCleanup } },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  Reflect.deleteProperty(window, 'contextweave')
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CredentialCleanupNotice />
      </QueryClientProvider>,
    ),
  )
}
async function eventually(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    check()
  })
}
describe('credential maintenance notice', () => {
  it('does not display a warning when nothing needs cleanup', async () => {
    await render()
    await eventually(() => expect(cleanupStatus).toHaveBeenCalledOnce())
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('shows pending cleanup, prevents duplicate retries and disappears after successful recovery', async () => {
    cleanupStatus.mockResolvedValue({
      ok: true,
      data: { pendingCount: 2, temporaryFilesPending: true },
    })
    let finish!: () => void
    retryCleanup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: empty })
        }),
    )
    await render()
    await eventually(() => expect(container.textContent).toContain('proxy.cleanup.description 2'))
    expect(container.textContent).toContain('proxy.cleanup.temporary')
    const button = container.querySelector('button')!
    await act(async () => button.click())
    await eventually(() => expect(button.disabled).toBe(true))
    await act(async () => button.click())
    expect(retryCleanup).toHaveBeenCalledOnce()
    cleanupStatus.mockResolvedValue({ ok: true, data: empty })
    await act(async () => finish())
    await eventually(() => expect(container.querySelector('[role="alert"]')).toBeNull())
  })
  it('shows temporary-file failures without claiming there are zero credentials to clean', async () => {
    cleanupStatus.mockResolvedValue({
      ok: true,
      data: { pendingCount: 0, temporaryFilesPending: true },
    })
    await render()
    await eventually(() => expect(container.textContent).toContain('proxy.cleanup.temporary'))
    expect(container.textContent).not.toContain('proxy.cleanup.description')
    expect(container.querySelector('button')).not.toBeNull()
  })
  it('shows query and retry failures without losing the retry control', async () => {
    cleanupStatus.mockRejectedValue(new Error('read failed'))
    retryCleanup.mockRejectedValueOnce(new Error('retry failed'))
    await render()
    await eventually(() => expect(container.textContent).toContain('proxy.cleanup.failed'))
    await act(async () => container.querySelector('button')!.click())
    await eventually(() => {
      expect(retryCleanup).toHaveBeenCalledOnce()
      expect(container.querySelector('button')!.disabled).toBe(false)
    })
    expect(container.textContent).toContain('proxy.cleanup.failed')
    cleanupStatus.mockResolvedValue({ ok: true, data: empty })
    await act(async () => container.querySelector('button')!.click())
    await eventually(() => expect(container.querySelector('[role="alert"]')).toBeNull())
  })
})
