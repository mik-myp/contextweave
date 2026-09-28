// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { SettingsStoragePage } from './settings-storage-page'
const state = vi.hoisted(() => ({ copyPath: vi.fn(), setNotice: vi.fn() }))
vi.mock('@/app/use-app-data', () => ({
  useAppData: () => ({
    paths: {
      dataRoot: '/fixture/data',
      environmentRoot: '/fixture/environments',
      kernelRoot: '/fixture/kernels',
      logRoot: '/fixture/logs',
      userData: '/fixture/user',
    },
    appInfo: { secureStorageAvailable: true },
    loading: false,
    setNotice: state.setNotice,
  }),
}))
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('contextweave', { app: { copyPath: state.copyPath } })
  vi.clearAllMocks()
  state.copyPath.mockResolvedValue({ ok: true, data: true })
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function copy() {
  await act(async () =>
    root.render(
      <I18nProvider>
        <SettingsStoragePage />
      </I18nProvider>,
    ),
  )
  const button = container.querySelector('button')
  expect(button).not.toBeNull()
  await act(async () => button?.click())
}
it('copies using the controlled native key even when browser clipboard permission is unavailable', async () => {
  await copy()
  expect(state.copyPath).toHaveBeenCalledWith('dataRoot')
  expect(state.setNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  expect(container.textContent).not.toMatch(/帮助与故障排查|高级诊断|清理应用运行记录/)
})
it('reports native clipboard failures rather than claiming success', async () => {
  state.copyPath.mockResolvedValue({ ok: false, code: 'COMMAND_FAILED', message: 'COMMAND_FAILED' })
  await copy()
  expect(state.setNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
})
