// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { appUpdateStateSchema, type AppUpdateState } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { SettingsUpdatesPage } from './settings-updates-page'
const { model, mutate, openRelease } = vi.hoisted(() => ({
  model: {
    state: undefined as AppUpdateState | undefined,
    loading: false,
    error: undefined as string | undefined,
    isPending: false,
  },
  mutate: vi.fn(),
  openRelease: vi.fn(),
}))
vi.mock('@/app/use-app-data', () => ({
  useAppData: () => ({ appInfo: { version: '0.1.6', platform: 'win32', arch: 'x64' } }),
}))
vi.mock('../hooks/use-app-update', () => ({
  useAppUpdate: () => ({ ...model, command: { mutate, isPending: model.isPending }, openRelease }),
}))
let root: Root, container: HTMLDivElement
const release = {
  version: '0.1.7',
  url: 'https://example.test/releases/0.1.7',
  publishedAt: '2026-09-25T00:00:00Z',
  asset: {
    fileName: 'ContextWeave.exe',
    url: 'https://example.test/download.exe',
    sha256: 'a'.repeat(64),
    sizeBytes: 1000,
  },
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  model.loading = false
  model.error = undefined
  model.isPending = false
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
async function render(phase: AppUpdateState['phase']) {
  model.state = appUpdateStateSchema.parse({
    phase,
    currentVersion: '0.1.6',
    receivedBytes: 100,
    totalBytes: 1000,
    ...(phase === 'idle'
      ? {}
      : { release: phase === 'unsupported' ? { ...release, asset: undefined } : release }),
  })
  await act(async () =>
    root.render(
      <I18nProvider>
        <SettingsUpdatesPage />
      </I18nProvider>,
    ),
  )
}
function button(label: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))
}
it('checks updates only after a user action', async () => {
  await render('idle')
  expect(mutate).not.toHaveBeenCalled()
  await act(async () => button('检查更新')!.click())
  expect(mutate).toHaveBeenCalledExactlyOnceWith('check')
})
it.each([
  ['available', '下载、安装并重启', 'install'],
  ['ready', '安装并重启', 'openInstaller'],
  ['downloading', '取消下载', 'cancel'],
] as const)(
  'routes %s action to %s without asking the user to quit manually',
  async (phase, label, action) => {
    await render(phase)
    await act(async () => button(label)!.click())
    expect(mutate).toHaveBeenCalledExactlyOnceWith(action)
  },
)
it('disables concurrent update actions while installation is running', async () => {
  await render('installing')
  expect(button('检查更新')!.disabled).toBe(true)
  expect(button('下载、安装并重启')!.disabled).toBe(true)
  expect(container.textContent).toContain('正在准备安装')
})
it('does not offer an incompatible package but keeps release notes accessible', async () => {
  await render('unsupported')
  expect(button('下载、安装并重启')).toBeUndefined()
  await act(async () => button('发行说明')!.click())
  expect(openRelease).toHaveBeenCalledOnce()
  expect(mutate).not.toHaveBeenCalled()
})
it('keeps a command failure visible and permits a fresh check', async () => {
  model.error = 'fixture localized update failure'
  await render('error')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(model.error)
  expect(button('检查更新')!.disabled).toBe(false)
})
