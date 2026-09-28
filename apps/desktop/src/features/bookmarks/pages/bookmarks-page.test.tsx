// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  type Bookmark,
  type DefaultBookmarks,
  type IpcResult,
  type SaveDefaultBookmarks,
} from '@contextweave/contracts'
import { fixtureWorkspace, withWorkspaceFixture } from '../../../../test-support/workspace'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { I18nProvider } from '@/i18n'
import { defaultBookmarksKey } from '../hooks/use-default-bookmarks'
import { BookmarksPage } from './bookmarks-page'
const one = { id: '00000000-0000-4000-8000-000000000001', name: 'One', url: 'https://one.test/' }
const two = {
  ...one,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Two',
  url: 'http://two.test/',
}
const snapshot = (items: Bookmark[] = [], revision = 0): DefaultBookmarks => ({
  ...fixtureWorkspace,
  revision,
  items,
})
const get = vi.fn<() => Promise<IpcResult<DefaultBookmarks>>>()
const save = vi.fn<(input: SaveDefaultBookmarks) => Promise<IpcResult<DefaultBookmarks>>>()
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('contextweave', withWorkspaceFixture({ bookmarks: { get, save } }))
  get.mockReset().mockResolvedValue({ ok: true, data: snapshot() })
  save.mockReset().mockImplementation(async (input) => ({
    ok: true,
    data: snapshot(input.items, input.expectedRevision + 1),
  }))
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
async function render() {
  await act(async () =>
    root.render(
      <TestWorkspaceProvider>
        <I18nProvider>
          <QueryClientProvider client={client}>
            <BookmarksPage />
          </QueryClientProvider>
        </I18nProvider>
      </TestWorkspaceProvider>,
    ),
  )
  await flush()
}
function button(name: string) {
  const element = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  )
  if (!element) throw new Error(`Missing button: ${name}`)
  return element
}
async function click(name: string) {
  await act(async () => button(name).click())
  await flush()
}
async function field(index: number, value: string) {
  await act(async () => {
    const input = document.querySelectorAll('input:not([type=checkbox]):not([type=hidden])')[index]!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('edits new rows inline, validates unsafe URLs and saves the startup choice without dialogs', async () => {
  await render()
  expect(container.querySelector('h1')).toBeNull()
  await click('新增书签')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await field(0, 'One')
  await field(1, 'file:///private')
  await click('保存更改')
  expect(save).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull()
  await field(1, one.url)
  await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click())
  await click('保存更改')
  expect(save).toHaveBeenCalledWith({
    expectedRevision: 0,
    items: [expect.objectContaining({ name: 'One', url: one.url, openOnStart: true })],
  })
  expect(container.textContent).toContain('书签已保存')
})
it('edits existing rows in place, offers drag handles instead of move buttons and can undo deletion', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one, two], 3) })
  await render()
  expect(button('拖动排序: One')).toBeDefined()
  expect(container.querySelector('[aria-label="上移: One"]')).toBeNull()
  await field(0, 'Edited')
  await click('删除书签: Two')
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(container.querySelectorAll('li')).toHaveLength(1)
  await click('撤销删除')
  expect(container.querySelectorAll('li')).toHaveLength(2)
  await click('保存更改')
  expect(save).toHaveBeenLastCalledWith({
    expectedRevision: 3,
    items: [{ ...one, name: 'Edited' }, two],
  })
})
it('supports an empty saved template and explicit discard without changing persisted profiles', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one]) })
  await render()
  await click('删除书签: One')
  await click('放弃更改')
  expect(container.querySelectorAll('li')).toHaveLength(1)
  await click('删除书签: One')
  await click('保存更改')
  expect(save).toHaveBeenCalledWith({ expectedRevision: 0, items: [] })
})
it('guards duplicate saves and disables editing during persistence', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one]) })
  let finish!: (value: IpcResult<DefaultBookmarks>) => void
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await field(0, 'Edited')
  await act(async () => {
    button('保存更改').click()
    button('保存更改').click()
  })
  expect(save).toHaveBeenCalledOnce()
  expect(button('新增书签').disabled).toBe(true)
  expect(container.querySelector<HTMLInputElement>('input[id$="-name"]')?.disabled).toBe(true)
  await act(async () => finish({ ok: true, data: snapshot([{ ...one, name: 'Edited' }], 1) }))
  expect(client.getQueryData(defaultBookmarksKey(fixtureWorkspace))).toEqual(
    snapshot([{ ...one, name: 'Edited' }], 1),
  )
})
it('retains unsaved input after failure and supports retry', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one]) })
  save.mockResolvedValueOnce({ ok: false, code: 'COMMAND_FAILED', message: 'redacted' })
  await render()
  await field(0, 'Edited')
  await click('保存更改')
  await flush()
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  expect(container.querySelector<HTMLInputElement>('input[id$="-name"]')?.value).toBe('Edited')
  await click('保存更改')
  expect(save).toHaveBeenCalledTimes(2)
})
it('does not overwrite a concurrently updated template and preserves unsaved edits until discard', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one], 1) })
  await render()
  await field(0, 'Draft')
  await act(async () => {
    client.setQueryData(defaultBookmarksKey(fixtureWorkspace), snapshot([two], 2))
  })
  await flush()
  expect(container.textContent).toContain('书签已在其他位置更改')
  expect(button('保存更改').disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  await click('放弃更改')
  expect(container.querySelector<HTMLInputElement>('input[id$="-name"]')?.value).toBe('Two')
})
it('keeps load errors retryable without permitting writes', async () => {
  get.mockResolvedValueOnce({ ok: false, code: 'BOOKMARKS_SETTINGS_INVALID', message: 'redacted' })
  await render()
  await flush()
  expect(button('保存更改').disabled).toBe(true)
  expect(button('新增书签').disabled).toBe(true)
  await click('重试')
  expect(button('新增书签').disabled).toBe(false)
})
it('ignores completion after unmount rather than contaminating another workspace cache', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one]) })
  let finish!: (value: IpcResult<DefaultBookmarks>) => void
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await field(0, 'Edited')
  await click('保存更改')
  await act(async () => root.render(<div>Other workspace</div>))
  await act(async () => finish({ ok: true, data: snapshot([two], 1) }))
  expect(container.textContent).toBe('Other workspace')
  expect(client.getQueryData(defaultBookmarksKey(fixtureWorkspace))).toEqual(snapshot([one]))
})
