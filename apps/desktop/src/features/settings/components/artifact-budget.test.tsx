// @vitest-environment jsdom
import { withWorkspaceFixture } from '../../../../test-support/workspace'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type {
  ArtifactBudget as Budget,
  ArtifactBudgetUpdate,
  IpcResult,
} from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { ArtifactBudget } from './artifact-budget'
import { artifactBudgetKey } from '../hooks/use-artifact-budget'
const get = vi.fn<() => Promise<IpcResult<Budget>>>()
const save = vi.fn<(input: ArtifactBudgetUpdate) => Promise<IpcResult<Budget>>>()
const budget = (limitMiB = 1024, revision = 1): Budget => ({
  limitMiB,
  revision,
  registered: { count: 1, bytes: 8 },
  reserved: { count: 1, bytes: 33554432 },
  availableBytes: Math.max(0, limitMiB * 1048576 - 33554440),
})
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({ storage: { getArtifactBudget: get, updateArtifactBudget: save } }),
  )
  localStorage.clear()
  get.mockReset()
  save.mockReset()
  get.mockResolvedValue({ ok: true, data: budget() })
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
          <ArtifactBudget />
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
  await flush()
}
function input() {
  return container.querySelector('input')!
}
function button(name: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === name)!
}
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
    input().dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function submit() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}
function deferred() {
  let resolve!: (value: IpcResult<Budget>) => void
  const promise = new Promise<IpcResult<Budget>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
it('shows registered and uncertain reservation accounting separately, with bounded policy and scope caveats', async () => {
  await render()
  expect(input().value).toBe('1024')
  expect(container.textContent).toContain('含待核对')
  expect(container.textContent).toContain('不是全盘磁盘配额')
  expect(container.textContent).toContain('不会取消已准入任务')
  expect(container.textContent).toContain('尚未提供显式文件清理')
  expect(button('保存截图预算').disabled).toBe(true)
  for (const value of ['31', '32.5', '', '102401']) {
    await edit(value)
    await submit()
    expect(input().getAttribute('aria-invalid')).toBe('true')
  }
  expect(save).not.toHaveBeenCalled()
})
it('serializes duplicate submissions, preserves the exact revision and adopts only confirmed policy', async () => {
  const pending = deferred()
  save.mockReturnValue(pending.promise)
  await render()
  await edit('64')
  await submit()
  await submit()
  expect(save).toHaveBeenCalledExactlyOnceWith({ limitMiB: 64, expectedRevision: 1 })
  expect(input().disabled).toBe(true)
  get.mockResolvedValue({ ok: true, data: budget(64, 2) })
  await act(async () => pending.resolve({ ok: true, data: budget(64, 2) }))
  await flush()
  expect(input().value).toBe('64')
  expect(container.textContent).toContain('截图预算已保存')
  expect(input().disabled).toBe(false)
})
it('preserves an unsaved draft on background changes and requires explicit adoption before a newer save', async () => {
  await render()
  await edit('128')
  await act(async () => {
    client.setQueryData(artifactBudgetKey, budget(64, 2))
  })
  await flush()
  expect(input().value).toBe('128')
  expect(container.textContent).toContain('设置已在其他操作中更新')
  await submit()
  expect(save).not.toHaveBeenCalled()
  await act(async () => button('采用当前设置').click())
  expect(input().value).toBe('64')
  const pending = deferred()
  save.mockReturnValue(pending.promise)
  await edit('96')
  await submit()
  expect(save).toHaveBeenCalledExactlyOnceWith({ limitMiB: 96, expectedRevision: 2 })
  get.mockResolvedValue({ ok: true, data: budget(96, 3) })
  await act(async () => pending.resolve({ ok: true, data: budget(96, 3) }))
  await flush()
})
it('keeps an unconfirmed save visible without retrying or declaring the previous policy authoritative', async () => {
  save.mockResolvedValue({
    ok: false,
    code: 'ARTIFACT_BUDGET_UPDATE_UNCONFIRMED',
    message: 'private raw data must not appear',
  })
  await render()
  await edit('64')
  await submit()
  await flush()
  expect(container.textContent).toContain('保存结果未确认')
  expect(container.textContent).not.toContain('private raw data')
  expect(container.textContent).not.toContain('截图预算已保存')
  expect(input().value).toBe('64')
  expect(save).toHaveBeenCalledTimes(1)
})
it('does not let a late save mutate shared query state after the component unmounts', async () => {
  const pending = deferred()
  save.mockReturnValue(pending.promise)
  await render()
  await edit('64')
  await submit()
  await act(async () => root.render(null))
  await act(async () => pending.resolve({ ok: true, data: budget(64, 2) }))
  await flush()
  expect(client.getQueryData(artifactBudgetKey)).toEqual(budget())
})
it('renders loading and failed reads without allowing a policy write, and can explicitly retry', async () => {
  const pending = deferred()
  get.mockReturnValueOnce(pending.promise)
  await render()
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  await act(async () =>
    pending.resolve({ ok: false, code: 'ARTIFACT_STORAGE_UNAVAILABLE', message: 'private' }),
  )
  await flush()
  expect(container.textContent).toContain('环境管理仍可使用')
  expect(container.querySelector('input')).toBeNull()
  await act(async () => button('重试').click())
  await flush()
  expect(input().value).toBe('1024')
  expect(save).not.toHaveBeenCalled()
})
