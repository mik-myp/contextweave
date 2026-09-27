// @vitest-environment jsdom
import { withWorkspaceFixture } from '../../../../test-support/workspace'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { proxySummarySchema, type IpcResult, type ProxyTestResult } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { ProxyDialog } from './proxy-dialog'

const { refresh, setNotice } = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  setNotice: vi.fn(),
}))
vi.mock('@/app/use-app-data', () => ({
  useAppData: () => ({ refresh, setNotice, appInfo: { secureStorageAvailable: true } }),
}))
const savedProxy = proxySummarySchema.parse({
  workspaceId: '00000000-0000-4000-8000-000000000001',
  proxyId: 'proxy-fixture',
  name: 'Fixture',
  type: 'http',
  host: 'proxy.example.test',
  port: 8080,
  username: 'test-user',
  hasPassword: true,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
})
const result: ProxyTestResult = {
  success: true,
  latencyMs: 12,
  checkedAt: '2026-09-27T00:00:00.000Z',
  exitIp: '203.0.113.42',
  connectivity: 'https',
}
const testProxy = vi.fn<() => Promise<IpcResult<ProxyTestResult>>>()
const saveProxy = vi.fn()
const onClose = vi.fn()
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  testProxy.mockReset().mockResolvedValue({ ok: true, data: result })
  saveProxy.mockReset().mockResolvedValue({ ok: true, data: savedProxy })
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({ proxy: { test: testProxy, save: saveProxy } }),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const render = async () =>
  act(async () =>
    root.render(
      <StrictMode>
        <I18nProvider>
          <ProxyDialog proxy={savedProxy} onClose={onClose} />
        </I18nProvider>
      </StrictMode>,
    ),
  )
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
const input = (name: string) => document.querySelector<HTMLInputElement>(`#proxy-${name}`)!
const change = async (name: string, value: string) =>
  act(async () => {
    const field = input(name)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
it('shows completed test results and invalidates them on a changed value', async () => {
  await render()
  await act(async () => button('测试连接').click())
  expect(testProxy).toHaveBeenCalledOnce()
  expect(document.body.textContent).toContain(result.exitIp)
  await change('host', 'changed.example.test')
  expect(document.body.textContent).not.toContain(result.exitIp)
  await act(async () => button('测试连接').click())
  expect(document.body.textContent).toContain(result.exitIp)
  expect(testProxy).toHaveBeenLastCalledWith(
    expect.objectContaining({ config: expect.objectContaining({ host: 'changed.example.test' }) }),
  )
})
it('subscribes to password clearing, disables the field and never sends the discarded password', async () => {
  await render()
  await change('password', 'fixture-only-password')
  await act(async () => document.querySelector<HTMLButtonElement>('#proxy-clear-password')!.click())
  expect(input('password').disabled).toBe(true)
  expect(input('password').value).toBe('')
  await act(async () => button('保存').click())
  expect(saveProxy).toHaveBeenCalledWith(
    expect.objectContaining({ clearPassword: true, password: undefined }),
  )
  expect(onClose).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledOnce()
})
it('ignores a test result after a value changes while the request is pending', async () => {
  let finish!: (value: IpcResult<ProxyTestResult>) => void
  testProxy.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await act(async () => button('测试连接').click())
  expect(button('正在测试…').disabled).toBe(true)
  // Native editing is disabled during a test. A programmatic form update must also invalidate it.
  await change('host', 'changed.example.test')
  await act(async () => finish({ ok: true, data: result }))
  expect(document.body.textContent).not.toContain(result.exitIp)
})
it('does not apply the result of an unmounted dialog to a newly opened dialog', async () => {
  let finish!: (value: IpcResult<ProxyTestResult>) => void
  testProxy.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await act(async () => button('测试连接').click())
  await act(async () => root.render(null))
  await render()
  await act(async () => finish({ ok: true, data: result }))
  expect(document.body.textContent).not.toContain(result.exitIp)
  expect(saveProxy).not.toHaveBeenCalled()
})
