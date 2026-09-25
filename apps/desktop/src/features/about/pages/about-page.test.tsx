// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'
import { AboutPage } from './about-page'
const { state, refresh, setNotice, openExternal } = vi.hoisted(() => ({
  state: { appError: undefined as string | undefined },
  refresh: vi.fn(),
  setNotice: vi.fn(),
  openExternal: vi.fn(),
}))
vi.mock('@/app/use-app-data', () => ({
  useAppData: () => ({
    appInfo: { version: '0.1.7', platform: 'darwin', arch: 'arm64' },
    ...state,
    refresh,
    setNotice,
  }),
}))
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'contextweave', {
    configurable: true,
    value: { app: { openExternal } },
  })
  localStorage.clear()
  state.appError = undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
async function render() {
  await act(async () =>
    root.render(
      <I18nProvider>
        <AboutPage />
      </I18nProvider>,
    ),
  )
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  )
  if (!result) throw new Error('button missing')
  return result
}
it('shows current build metadata and retries a failed metadata load', async () => {
  state.appError = 'fixture load failure'
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('fixture load failure')
  await act(async () => button('重试').click())
  expect(refresh).toHaveBeenCalledOnce()
  state.appError = undefined
  await render()
  expect(container.textContent).toContain('0.1.7')
  expect(container.textContent).toContain('darwin / arm64')
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('opens only the displayed project link through the bridge and sanitizes a rejected request', async () => {
  openExternal.mockRejectedValue(new Error('https://user:private-secret@private.test'))
  await render()
  await act(async () => button('New API').click())
  expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com/QuantumNous/new-api')
  expect(setNotice).toHaveBeenCalledExactlyOnceWith({
    kind: 'error',
    message: errorMessage('IPC_UNAVAILABLE'),
  })
  expect(container.textContent).not.toContain('private-secret')
})
