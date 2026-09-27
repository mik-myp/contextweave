// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IpcResult, LocalWorkspace } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { SidebarProvider } from '@/components/ui/sidebar'
import { WorkspaceSwitcher } from './workspace-switcher'
import { localWorkspaceKey } from '../hooks/use-workspace'

const identity: LocalWorkspace = {
  workspaceId: 'd326147b-89da-40fa-8cc0-7b9ad0dfacb6',
  kind: 'personal',
  storageMode: 'local',
  createdAt: '2026-09-27T00:00:00.000Z',
}
const current = vi.fn<() => Promise<IpcResult<LocalWorkspace>>>()
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('contextweave', { workspace: { current } })
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  )
  localStorage.clear()
  current.mockReset().mockResolvedValue({ ok: true, data: identity })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
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
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
async function render() {
  await act(async () =>
    root.render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <SidebarProvider>
            <WorkspaceSwitcher />
          </SidebarProvider>
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
  await flush()
}
function deferred() {
  let resolve!: (value: IpcResult<LocalWorkspace>) => void
  const promise = new Promise<IpcResult<LocalWorkspace>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function openWithKeyboard() {
  const button = container.querySelector('button')!
  await act(async () => {
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  await flush()
}
it('does not invent an identity while loading and disables repeated loading actions', async () => {
  const pending = deferred()
  current.mockReturnValue(pending.promise)
  await render()
  expect(container.textContent).toContain('加载工作空间')
  expect(container.querySelector('button')?.disabled).toBe(true)
  expect(document.querySelector('[data-workspace-id]')).toBeNull()
  await act(async () => pending.resolve({ ok: true, data: identity }))
  await flush()
  expect(container.textContent).toContain('本地 · SQLite')
  expect(current).toHaveBeenCalledExactlyOnceWith()
})
it('opens real workspace details with the keyboard, uses the stable ID, and exposes no team management', async () => {
  await render()
  await openWithKeyboard()
  expect(document.querySelector('[data-workspace-id]')?.textContent).toBe(identity.workspaceId)
  const choices = document.querySelectorAll('[role="menuitemradio"]')
  expect(choices).toHaveLength(1)
  expect(choices[0]?.getAttribute('aria-checked')).toBe('true')
  expect(document.body.textContent).toContain('未启用团队或远程存储')
  expect(document.body.textContent).not.toContain('添加团队')
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  await flush()
  expect(document.querySelector('[data-workspace-id]')).toBeNull()
})
it('hides stale identity after a failed read, redacts raw errors, and retries explicitly', async () => {
  current.mockRejectedValue(new Error('/private/credential-canary'))
  client.setQueryData(localWorkspaceKey, identity)
  await render()
  await act(async () => {
    await client.invalidateQueries({ queryKey: localWorkspaceKey })
  })
  await flush()
  expect(container.textContent).toContain('工作空间暂不可用')
  expect(container.textContent).not.toContain('credential-canary')
  expect(document.querySelector('[data-workspace-id]')).toBeNull()
  current.mockResolvedValue({ ok: true, data: identity })
  await act(async () => container.querySelector('button')!.click())
  await flush()
  expect(container.textContent).toContain('本地 · SQLite')
  await openWithKeyboard()
  expect(document.querySelector('[data-workspace-id]')?.textContent).toBe(identity.workspaceId)
})
it('renders English workspace details without changing the persisted identity', async () => {
  localStorage.setItem('contextweave:locale', 'en-US')
  await render()
  await openWithKeyboard()
  expect(document.body.textContent).toContain('Workspace ID')
  expect(document.body.textContent).toContain('Teams and remote storage are not enabled')
  expect(document.querySelector('[data-workspace-id]')?.textContent).toBe(identity.workspaceId)
})
