// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { kernelCatalogSchema, type KernelRelease } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'
import { KernelInstallDialog } from './kernel-install-dialog'
import { KernelCapabilities } from './kernel-capabilities'
const { refresh, setNotice, install, cancelInstall } = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  setNotice: vi.fn(),
  install: vi.fn(),
  cancelInstall: vi.fn(),
}))
vi.mock('@/app/use-app-data', () => ({ useAppData: () => ({ refresh, setNotice }) }))
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  Object.defineProperty(window, 'contextweave', {
    configurable: true,
    value: { kernel: { install, cancelInstall } },
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function render(release: Partial<KernelRelease> = {}) {
  client.setQueryData(
    ['local', 'kernels', 'catalog', 'fingerprint-chromium'],
    kernelCatalogSchema.parse({
      sourceStatus: 'cached',
      releases: [
        {
          id: 'fingerprint-chromium-148-0-7778-215',
          provider: 'fingerprint-chromium',
          version: '148.0.7778.215',
          platform: 'win32',
          arch: 'x64',
          source: 'https://example.test/release',
          installable: true,
          installed: false,
          ...release,
        },
      ],
    }),
  )
  await act(async () =>
    root.render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <KernelInstallDialog open onOpenChange={() => {}} />
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
}
function button(label: string) {
  const result = [...document.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  )
  if (!result) throw new Error(`Missing button ${label}`)
  return result
}
it('explains why an unreviewed release cannot be downloaded', async () => {
  await render({ installable: false, reason: 'RELEASE_UNREVIEWED' })
  expect(document.body.textContent).toContain(errorMessage('RELEASE_UNREVIEWED'))
  expect(button('下载并安装').disabled).toBe(true)
  await act(async () => button('下载并安装').click())
  expect(install).not.toHaveBeenCalled()
})
it('displays a localized install failure without exposing backend text and allows retry', async () => {
  install
    .mockResolvedValueOnce({
      ok: false,
      code: 'RELEASE_UNREVIEWED',
      message: 'private fixture path',
    })
    .mockResolvedValueOnce({ ok: true, data: {} })
  await render()
  await act(async () => button('下载并安装').click())
  expect(document.body.textContent).toContain(errorMessage('RELEASE_UNREVIEWED'))
  expect(document.body.textContent).not.toContain('private fixture path')
  expect(setNotice).not.toHaveBeenCalled()
  expect(button('下载并安装').disabled).toBe(false)
  await act(async () => button('下载并安装').click())
  expect(install).toHaveBeenCalledTimes(2)
  expect(refresh).toHaveBeenCalledOnce()
  expect(setNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
})
it('does not display declared but unverified fingerprint capabilities as verified', async () => {
  await act(async () =>
    root.render(
      <I18nProvider>
        <KernelCapabilities
          report={{
            cdp: {
              declared: true,
              state: 'verified',
              version: '148.0.7778.215',
              checkedAt: '2026-09-25T00:00:00Z',
              evidence: 'Fixture handshake',
            },
            timezone: { declared: true, state: 'unverified' },
          }}
        />
      </I18nProvider>,
    ),
  )
  const rows = container.querySelectorAll('dl > div')
  expect(rows[0].textContent).toContain('已验证')
  expect(rows[1].textContent).toContain('未验证')
  expect(rows[1].textContent).not.toContain('已验证')
})
