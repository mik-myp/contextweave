// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { kernelSummarySchema, type KernelSummary } from '@contextweave/contracts'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { withWorkspaceFixture } from '../../../../test-support/workspace'
import { I18nProvider } from '@/i18n'
import { KernelsPage } from './kernels-page'
let rows: KernelSummary[]
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setNotice: vi.fn(),
  removeMany: vi.fn(),
  rename: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('@/app/use-app-data', () => ({
  useAppData: () => ({ kernels: rows, loading: false, ...mocks }),
}))
vi.mock('@/components/ui/toast', () => ({ toast: { add: vi.fn() } }))
function item(id: string, removable: boolean) {
  return kernelSummarySchema.parse({
    id,
    label: id,
    family: 'chromium',
    platform: 'darwin',
    arch: 'arm64',
    version: '123.0.0.1',
    status: 'available',
    packageAvailable: true,
    removable,
    capabilities: { cdp: true },
    capabilityReport: { cdp: { declared: true, state: 'unverified' } },
    providerStatus: 'candidate',
  })
}
let container: HTMLDivElement, root: Root, client: QueryClient
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
async function render() {
  await act(async () =>
    root.render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <TestWorkspaceProvider>
            <KernelsPage />
          </TestWorkspaceProvider>
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
  await flush()
}
function button(label: string, scope: ParentNode = document) {
  const result = [...scope.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  )
  if (!result) throw Error(`Missing button ${label}`)
  return result
}
async function click(label: string, scope: ParentNode = document) {
  await act(async () => button(label, scope).click())
  await flush()
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  localStorage.setItem('contextweave:locale', 'en-US')
  rows = [item('standard-chromium', false), item('managed-one', true), item('managed-two', true)]
  mocks.refresh.mockResolvedValue(undefined)
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      kernel: { removeMany: mocks.removeMany, rename: mocks.rename, verify: mocks.verify },
    }),
  )
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it('selects only app-managed kernels and keeps a refused item selected after partial removal', async () => {
  mocks.removeMany.mockImplementation(async () => {
    rows = rows.filter((item) => item.id !== 'managed-one')
    return {
      ok: true,
      data: [
        { id: 'managed-one', ok: true },
        { id: 'managed-two', ok: false, code: 'KERNEL_IN_USE' },
      ],
    }
  })
  await render()
  const local = [...container.querySelectorAll('tbody tr')].find((row) =>
    row.textContent?.includes('standard-chromium'),
  )!
  expect(local.querySelector('[role="checkbox"]')?.getAttribute('aria-disabled')).toBe('true')
  await act(async () => container.querySelector<HTMLElement>('thead [role="checkbox"]')!.click())
  await click('Delete selected', container)
  const dialog = document.querySelector('[role="alertdialog"]')!
  expect(dialog.textContent).not.toContain('standard-chromium')
  await click('Delete selected', dialog)
  expect(mocks.removeMany).toHaveBeenCalledExactlyOnceWith(['managed-one', 'managed-two'])
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('managed-two')
  expect(container.querySelectorAll('tbody [aria-checked="true"]')).toHaveLength(1)
})
it('renames display metadata without changing identity and offers a dedicated verification action', async () => {
  mocks.rename.mockResolvedValue({ ok: true, data: { ...rows[1], label: 'Work browser' } })
  await render()
  const row = [...container.querySelectorAll('tbody tr')].find((item) =>
    item.textContent?.includes('managed-one'),
  )!
  await click('Rename', row)
  const input = document.querySelector<HTMLInputElement>('#kernel-custom-name')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Work browser',
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  await flush()
  expect(mocks.rename).toHaveBeenCalledExactlyOnceWith({ id: 'managed-one', name: 'Work browser' })
  mocks.verify.mockResolvedValue({ ok: true, data: rows[1] })
  await click('View details', row)
  await click('Verify again')
  expect(mocks.verify).toHaveBeenCalledExactlyOnceWith('managed-one')
})
