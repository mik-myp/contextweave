// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultThemeConfig } from '@contextweave/contracts'
import { ThemeProvider, useTheme } from './theme-provider'

function Controls() {
  const { theme, setTheme, retrySave, saveStatus } = useTheme()
  return (
    <>
      <button onClick={() => setTheme({ color: '#000000' })}>Black</button>
      <button onClick={retrySave}>Retry</button>
      <output>
        {theme.color}:{saveStatus}
      </output>
    </>
  )
}

describe('theme provider', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('applies loaded settings without writing during StrictMode mount', async () => {
    const write = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('contextweave', { settings: { setTheme: write } })
    const initialTheme = { ...defaultThemeConfig, color: '#16A34A', font: 'serif' as const }
    await act(async () =>
      root.render(
        <StrictMode>
          <ThemeProvider initialTheme={initialTheme}>
            <Controls />
          </ThemeProvider>
        </StrictMode>,
      ),
    )
    expect(write).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.themeColor).toBe('#16A34A')
    expect(document.documentElement.style.getPropertyValue('--theme-font')).toContain('Georgia')
  })

  it('keeps immediate preview after failure and exposes retry without changing the selection', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('contextweave', { settings: { setTheme: write } })
    await act(async () =>
      root.render(
        <ThemeProvider>
          <Controls />
        </ThemeProvider>,
      ),
    )
    await act(async () => container.querySelector('button')!.click())
    expect(document.documentElement.dataset.themeColor).toBe('#000000')
    expect(container.querySelector('output')?.textContent).toBe('#000000:error')
    await act(async () => container.querySelectorAll('button')[1].click())
    expect(container.querySelector('output')?.textContent).toBe('#000000:saved')
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0])
  })
})
