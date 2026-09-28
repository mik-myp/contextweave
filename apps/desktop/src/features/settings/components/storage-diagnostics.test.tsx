// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { withWorkspaceFixture } from '../../../../test-support/workspace'
import { StorageDiagnostics } from './storage-diagnostics'

const budget = vi.fn(),
  inventory = vi.fn(),
  save = vi.fn()
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  budget.mockReset().mockResolvedValue({
    ok: true,
    data: {
      limitMiB: 1024,
      revision: 1,
      registered: { count: 0, bytes: 0 },
      reserved: { count: 0, bytes: 0 },
      availableBytes: 1024 * 1024 * 1024,
    },
  })
  inventory.mockReset().mockResolvedValue({
    ok: true,
    data: {
      items: [],
      previousCursor: null,
      nextCursor: null,
      totals: { count: 0, bytes: 0 },
    },
  })
  save.mockReset()
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      storage: {
        getArtifactBudget: budget,
        pageArtifacts: inventory,
        updateArtifactBudget: save,
      },
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
async function render() {
  await act(async () =>
    root.render(
      <TestWorkspaceProvider>
        <I18nProvider>
          <QueryClientProvider client={client}>
            <StorageDiagnostics />
          </QueryClientProvider>
        </I18nProvider>
      </TestWorkspaceProvider>,
    ),
  )
}
async function toggle(open: boolean) {
  await act(async () => {
    const details = container.querySelector('details')!
    details.open = open
    details.dispatchEvent(new Event('toggle'))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
it('does not query development output on entry and loads it only after explicit disclosure', async () => {
  await render()
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('summary')?.textContent).toContain('高级诊断')
  expect(budget).not.toHaveBeenCalled()
  expect(inventory).not.toHaveBeenCalled()
  expect(container.querySelector('input')).toBeNull()
  await toggle(true)
  expect(budget).toHaveBeenCalledOnce()
  expect(inventory).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('不是日常环境管理或全盘空间清理')
  expect(container.textContent).toContain('已登记截图')
})
it('retains an unsaved budget edit across collapse and reopening without writing or refetching', async () => {
  await render()
  await toggle(true)
  const input = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2048')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await toggle(false)
  await toggle(true)
  expect(container.querySelector('input')?.value).toBe('2048')
  expect(budget).toHaveBeenCalledOnce()
  expect(inventory).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
})
