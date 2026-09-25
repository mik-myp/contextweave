// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { RouteError } from './route-error'
import { router as applicationRouter } from '../router'

let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(console, 'error').mockImplementation(() => {}) // Expected React boundary diagnostics.
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // Expected dev-only Router diagnostics.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function fixture(kind: 'loader' | 'render', locale = 'zh-CN') {
  localStorage.setItem('contextweave:locale', locale)
  let broken = true
  const secret = 'https://username:fixture-secret@private.test/profile'
  const rootRoute = createRootRoute({ component: Outlet })
  const load = vi.fn(() => {
    if (kind === 'loader' && broken) throw new Error(secret)
  })
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/broken',
    loader: load,
    component: () => {
      if (kind === 'render' && broken) throw new Error(secret)
      return <p>recovered page</p>
    },
  })
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: '/environments',
    component: () => <p>environments page</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([route, home]),
    history: createMemoryHistory({ initialEntries: ['/broken'] }),
    defaultErrorComponent: RouteError,
  })
  await act(async () => {
    root.render(
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>,
    )
  })
  await act(async () => {
    await router.load()
  })
  return {
    router,
    load,
    repair: () => {
      broken = false
    },
    secret,
  }
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  )
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}
it.each(['loader', 'render'] as const)(
  'recovers from a %s error without displaying the raw error',
  async (kind) => {
    const f = await fixture(kind)
    expect(container.textContent).toContain('页面暂时无法显示')
    expect(container.textContent).not.toContain(f.secret)
    expect(container.textContent).not.toContain('Something went wrong')
    const before = f.load.mock.calls.length
    f.repair()
    await act(async () => button('重试').click())
    expect(container.textContent).toContain('recovered page')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(f.load.mock.calls.length).toBeGreaterThan(before)
  },
)
it('uses English messages and can leave a persistently broken page', async () => {
  const f = await fixture('loader', 'en-US')
  expect(container.textContent).toContain('This page could not be displayed')
  await act(async () => button('Back to environments').click())
  expect(f.router.state.location.pathname).toBe('/environments')
  expect(container.textContent).toContain('environments page')
})
it('fences repeated retry requests and sanitizes retry failure while allowing another attempt', async () => {
  const f = await fixture('loader')
  let reject!: (error: Error) => void
  const reload = vi.spyOn(f.router, 'invalidate').mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail
      }),
  )
  await act(async () => {
    const retry = button('重试')
    retry.click()
    retry.click()
  })
  expect(reload).toHaveBeenCalledOnce()
  expect([...container.querySelectorAll('button')].every((item) => item.disabled)).toBe(true)
  await act(async () => reject(new Error(f.secret)))
  expect(container.textContent).toContain('页面恢复失败')
  expect(container.textContent).not.toContain(f.secret)
  expect(button('重试').disabled).toBe(false)
  f.repair()
  await act(async () => button('重试').click())
  expect(container.textContent).toContain('recovered page')
})
it('installs the local error component as the application-wide Router fallback', () => {
  expect(applicationRouter.options.defaultErrorComponent).toBe(RouteError)
})
