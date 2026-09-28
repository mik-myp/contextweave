// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { withWorkspaceFixture } from '../../../../test-support/workspace'
import { StorageMaintenance } from './storage-maintenance'
import { OrphanDirectories } from './orphan-directories'

const receipt = vi.fn(),
  orphans = vi.fn()
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  receipt.mockReset().mockResolvedValue({ ok: true, data: null })
  orphans.mockReset().mockResolvedValue({ ok: true, data: [] })
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      storage: { getHistoryCleanupReceipt: receipt, orphans },
    }),
  )
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})
async function render(children = <StorageMaintenance />) {
  await act(async () =>
    root.render(
      <TestWorkspaceProvider>
        <I18nProvider>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </I18nProvider>
      </TestWorkspaceProvider>,
    ),
  )
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  )!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
it('loads history maintenance only on request and retains the chosen retention while collapsed', async () => {
  await render()
  expect(receipt).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-label="历史记录清理"]')).toBeNull()
  await click('查看清理选项')
  expect(receipt).toHaveBeenCalledOnce()
  await click('180')
  await click('收起清理选项')
  await click('查看清理选项')
  const selected = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('180'),
  )!
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(receipt).toHaveBeenCalledOnce()
})
it('does not show a permanent empty unassociated-directory section', async () => {
  await render(<OrphanDirectories />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(orphans).toHaveBeenCalledOnce()
  expect(container.textContent).toBe('')
})
it('keeps directory inspection failures actionable rather than reporting zero problems', async () => {
  orphans.mockResolvedValue({ ok: false, code: 'COMMAND_FAILED' })
  await render(<OrphanDirectories />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  expect(container.textContent).toContain('重试')
})
