// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { ThemeProvider, useTheme } from '../theme-provider'
import { ThemeDrawer } from './theme-drawer'

function ExternalControls() {
  const { setTheme } = useTheme()
  return (
    <>
      <button onClick={() => setTheme({ color: '#16A34A' })}>External color</button>
      <button onClick={() => setTheme({ radius: 'none' })}>Unrelated change</button>
    </>
  )
}
let root: Root
let container: HTMLDivElement
const save = vi.fn().mockResolvedValue({ ok: true })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('contextweave', { settings: { setTheme: save } })
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
it('preserves an incomplete color draft across unrelated settings and resets it only for a new committed color', async () => {
  await act(async () =>
    root.render(
      <I18nProvider>
        <ThemeProvider>
          <ThemeDrawer />
          <ExternalControls />
        </ThemeProvider>
      </I18nProvider>,
    ),
  )
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  const input = document.querySelector<HTMLInputElement>('input[placeholder="#2563EB"]')!
  expect(input).not.toBeNull()
  const write = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await write('#ab')
  expect(input.value).toBe('#ab')
  expect(save).not.toHaveBeenCalled()
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Unrelated change')!
      .click(),
  )
  expect(input.value).toBe('#ab')
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'External color')!
      .click(),
  )
  expect(input.value).toBe('#16A34A')
  await write('#abcdef')
  expect(input.value).toBe('#ABCDEF')
  expect(document.documentElement.dataset.themeColor).toBe('#ABCDEF')
})
