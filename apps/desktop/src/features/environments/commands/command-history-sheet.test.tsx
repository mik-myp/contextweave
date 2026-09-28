// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { CommandHistorySheet } from './command-history-sheet'
const commands = vi.fn()
vi.mock('./environment-commands', () => ({
  EnvironmentCommands: () => {
    commands()
    return <p>history fixture</p>
  },
}))
it('keeps command diagnostics out of the primary page until explicitly requested', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    const render = (open: boolean) => (
      <I18nProvider>
        <CommandHistorySheet open={open} onOpenChange={() => {}} />
      </I18nProvider>
    )
    await act(async () => root.render(render(false)))
    expect(commands).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => root.render(render(true)))
    expect(commands).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('操作记录')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
