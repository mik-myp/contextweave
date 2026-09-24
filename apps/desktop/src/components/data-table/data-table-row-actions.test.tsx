// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { DataTableRowActions, type DataTableRowAction } from './data-table-row-actions'
import { TooltipProvider } from '../ui/tooltip'

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: () => 'More actions' }) }))

describe('table row actions', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  const actions = (count: number): DataTableRowAction[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `action-${index}`,
      label: `Action ${index + 1}`,
      icon: index === 4 ? Trash2Icon : PencilIcon,
      onClick: vi.fn(),
    }))
  async function render(items: DataTableRowAction[]) {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <DataTableRowActions label="Row actions" actions={items} />
        </TooltipProvider>,
      ),
    )
  }
  it('shows three accessible icon actions directly and no unnecessary menu', async () => {
    const items = actions(3)
    await render(items)
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(3)
    expect(container.textContent).toBe('')
    expect([...buttons].map((button) => button.getAttribute('aria-label'))).toEqual([
      'Action 1',
      'Action 2',
      'Action 3',
    ])
    expect([...buttons].every((button) => button.querySelector('svg'))).toBe(true)
    await act(async () => buttons[0].click())
    expect(items[0].onClick).toHaveBeenCalledOnce()
  })
  it('puts only the fourth and later actions into a menu with icons and labels', async () => {
    const items = actions(5)
    await render(items)
    expect(container.querySelectorAll('button')).toHaveLength(4)
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!
    await act(async () => trigger.click())
    const menuItems = document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    expect([...menuItems].map((item) => item.textContent)).toEqual(['Action 4', 'Action 5'])
    expect([...menuItems].every((item) => item.querySelector('svg'))).toBe(true)
    await act(async () => menuItems[1].click())
    expect(items[4].onClick).toHaveBeenCalledOnce()
    expect(items[0].onClick).not.toHaveBeenCalled()
  })
  it('keeps disabled actions focusable for their explanations without invoking them', async () => {
    const items = actions(1)
    items[0].disabled = true
    items[0].disabledReason = 'Stop the environment first'
    await render(items)
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      button.focus()
      button.click()
    })
    expect(items[0].onClick).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button)
  })
})
