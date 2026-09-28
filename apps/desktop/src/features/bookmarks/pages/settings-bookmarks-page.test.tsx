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
import { SettingsBookmarksPage } from './settings-bookmarks-page'
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
            <SettingsBookmarksPage />
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
    const input = document.querySelectorAll('input')[index]!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function apply() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  await flush()
}
it('shows an empty scoped template and accurate first-launch-only help in both languages', async () => {
  await render()
  expect(container.textContent).toContain('尚无默认书签')
  expect(container.textContent).toContain('克隆、导入')
  expect(container.textContent).toContain('不会自动打开网址')
  expect(button('保存模板').disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  expect(container.querySelector('a')).toBeNull()
})
it('validates credential-free HTTP(S) URLs, stages edits and saves only after confirmation', async () => {
  await render()
  await click('新增书签')
  await field(0, ' Example ')
  await field(1, 'https://u:p@example.test/')
  await apply()
  expect(document.querySelector('input[type="url"]')?.getAttribute('aria-invalid')).toBe('true')
  expect(save).not.toHaveBeenCalled()
  await field(1, 'https://example.test/')
  await apply()
  expect(container.textContent).toContain('Example')
  expect(container.textContent).toContain('列表更改尚未保存')
  await click('保存模板')
  expect(save).toHaveBeenCalledWith({
    expectedRevision: 0,
    items: [{ id: expect.any(String), name: 'Example', url: 'https://example.test/' }],
  })
  expect(container.textContent).toContain('模板已保存')
  expect(button('保存模板').disabled).toBe(true)
})
it('supports edit/cancel, keyboard-accessible ordering, delete confirmation and saving an empty list', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one, two], 3) })
  await render()
  expect(button('上移: One').disabled).toBe(true)
  expect(button('下移: Two').disabled).toBe(true)
  await click('编辑书签: One')
  await field(0, 'Discarded')
  await click('取消')
  expect(container.textContent).not.toContain('Discarded')
  expect(button('保存模板').disabled).toBe(true)
  await click('编辑书签: One')
  await field(0, 'Edited')
  await apply()
  await click('上移: Two')
  expect(
    [...container.querySelectorAll('li')].map((li) => li.querySelector('p')?.textContent),
  ).toEqual(['Two', 'Edited'])
  await click('删除书签: Two')
  await click('取消')
  expect(container.querySelectorAll('li')).toHaveLength(2)
  await click('删除书签: Two')
  await click('删除书签')
  await click('保存模板')
  expect(save).toHaveBeenLastCalledWith({
    expectedRevision: 3,
    items: [{ ...one, name: 'Edited' }],
  })
  await click('删除书签: Edited')
  await click('删除书签')
  await click('保存模板')
  expect(save).toHaveBeenLastCalledWith({ expectedRevision: 4, items: [] })
})
it('guards duplicate saves, disables edits during persistence and keeps the correct workspace cache', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one, two]) })
  let finish!: (value: IpcResult<DefaultBookmarks>) => void
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await click('上移: Two')
  await act(async () => {
    button('保存模板').click()
    button('保存模板').click()
  })
  expect(save).toHaveBeenCalledOnce()
  expect(button('新增书签').disabled).toBe(true)
  expect(button('放弃更改').disabled).toBe(true)
  await act(async () => finish({ ok: true, data: snapshot([two, one], 1) }))
  expect(client.getQueryData(defaultBookmarksKey(fixtureWorkspace))).toEqual(
    snapshot([two, one], 1),
  )
})
it('keeps unsaved edits after a save failure and supports retry', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one, two]) })
  save.mockResolvedValueOnce({ ok: false, code: 'COMMAND_FAILED', message: 'redacted' })
  await render()
  await click('上移: Two')
  await click('保存模板')
  await flush()
  expect(container.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0)
  expect(container.querySelector('li p')?.textContent).toBe('Two')
  await click('保存模板')
  expect(save).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('模板已保存')
})
it('does not overwrite a template that changed while a dialog was open', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one], 1) })
  await render()
  await click('编辑书签: One')
  await field(0, 'Draft')
  await act(async () => {
    client.setQueryData(defaultBookmarksKey(fixtureWorkspace), snapshot([two], 2))
  })
  await apply()
  expect(container.textContent).toContain('Draft')
  expect(container.textContent).toContain('模板已在其他位置更改')
  expect(button('保存模板').disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  await click('放弃更改')
  expect(container.querySelector('li p')?.textContent).toBe('Two')
})
it('shows loading and a retryable load error without enabling writes', async () => {
  let finish!: (value: IpcResult<DefaultBookmarks>) => void
  get.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  expect(button('保存模板').disabled).toBe(true)
  await act(async () =>
    finish({ ok: false, code: 'BOOKMARKS_SETTINGS_INVALID', message: 'redacted' }),
  )
  await flush()
  expect(container.textContent).toContain('原始数据未被覆盖')
  await click('重试')
  expect(container.textContent).toContain('尚无默认书签')
})
it('provides English help and labels without changing the data model', async () => {
  localStorage.setItem('contextweave:locale', 'en-US')
  await render()
  expect(container.textContent).toContain('including cloned and imported data')
  expect(button('Add bookmark').disabled).toBe(false)
  expect(button('Save template').disabled).toBe(true)
})
it('ignores completion after unmount rather than contaminating another workspace cache', async () => {
  get.mockResolvedValue({ ok: true, data: snapshot([one, two]) })
  let finish!: (value: IpcResult<DefaultBookmarks>) => void
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await click('上移: Two')
  await click('保存模板')
  await act(async () => root.render(<div>Other workspace</div>))
  await act(async () => finish({ ok: true, data: snapshot([two, one], 1) }))
  expect(container.textContent).toBe('Other workspace')
  expect(client.getQueryData(defaultBookmarksKey(fixtureWorkspace))).toEqual(snapshot([one, two]))
})
