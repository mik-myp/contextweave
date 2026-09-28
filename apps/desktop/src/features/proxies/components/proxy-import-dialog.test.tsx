// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportProxiesInput, ImportProxiesResult, IpcResult } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { withWorkspaceFixture } from '../../../../test-support/workspace'
import { ProxyImportDialog } from './proxy-import-dialog'

const importProxies =
  vi.fn<(input: ImportProxiesInput) => Promise<IpcResult<ImportProxiesResult>>>()
const onClose = vi.fn()
let root: Root
let container: HTMLDivElement
let client: QueryClient
const mixed: ImportProxiesResult = [
  { line: 1, status: 'created', proxyId: 'created-proxy' },
  {
    line: 3,
    status: 'error',
    code: 'CREDENTIAL_UNAVAILABLE',
    proxy: { type: 'http', host: 'refused.example', port: 80, hasCredentials: true },
  },
  {
    line: 4,
    status: 'error',
    code: 'INVALID_PROXY_LINE',
    proxy: { type: 'https', host: 'invalid.example', port: 65536, hasCredentials: true },
  },
  {
    line: 5,
    status: 'error',
    code: 'PROXY_SAVE_FAILED',
    proxy: { type: 'socks5', host: '[::1]', port: 1080, hasCredentials: true },
  },
  { line: 6, status: 'skipped', code: 'PROXY_ALREADY_EXISTS' },
  { line: 7, status: 'error', code: 'INVALID_PROXY_LINE' },
]
const source = [
  'created.example:80',
  '',
  'http://private-user:private-password@refused.example:80',
  'https://private-user:private-password@invalid.example:65536',
  'socks5://[::1]:1080:private-user:private-password',
  'created.example:80',
  'private-user private-password unrecognized',
].join('\n')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  importProxies.mockReset().mockResolvedValue({ ok: true, data: mixed })
  onClose.mockReset()
  vi.stubGlobal('contextweave', withWorkspaceFixture({ proxy: { import: importProxies } }))
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } },
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () =>
    root.render(
      <StrictMode>
        <TestWorkspaceProvider>
          <QueryClientProvider client={client}>
            <I18nProvider>
              <ProxyImportDialog onClose={onClose} />
            </I18nProvider>
          </QueryClientProvider>
        </TestWorkspaceProvider>
      </StrictMode>,
    ),
  )
}
function textarea() {
  const field = document.querySelector<HTMLTextAreaElement>('#proxy-import-text')
  if (!field) throw new Error('Missing proxy list')
  return field
}
function submitButton() {
  const element = document.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!element) throw new Error('Missing import button')
  return element
}
function formatTrigger() {
  const element = document.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
  if (!element) throw new Error('Missing format disclosure')
  return element
}
async function change(value: string) {
  await act(async () => {
    const field = textarea()
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => submitButton().click())
}
async function eventually(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    check()
  })
}

describe('proxy import dialog', () => {
  it.each(['zh-CN', 'en-US'])(
    'has only the proxy list and documents the HTTP default in %s',
    async (locale) => {
      window.localStorage.setItem('contextweave:locale', locale)
      await render()
      expect(document.querySelectorAll('textarea')).toHaveLength(1)
      expect(document.querySelectorAll('select, input, [role="combobox"]')).toHaveLength(0)
      expect(document.body.textContent).not.toMatch(/无协议时使用|Default protocol/)
      expect(document.body.textContent).toContain(
        locale === 'zh-CN' ? '未写协议时统一使用 HTTP' : 'Missing schemes always use HTTP',
      )
      expect(document.querySelector('#proxy-import-help')?.textContent).toBe(
        locale === 'zh-CN'
          ? '每次最多 200 个非空行，空行忽略。'
          : 'Up to 200 non-empty lines per import; blank lines are ignored.',
      )
      expect(document.body.textContent).not.toContain('IPv6')
      expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull()
      const close = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === (locale === 'zh-CN' ? '关闭' : 'Close'),
      )
      expect(close?.disabled).toBe(false)
      expect(textarea().getAttribute('aria-describedby')).toBe('proxy-import-help')
      expect(submitButton().disabled).toBe(true)
      await change(' \n\r\n')
      expect(submitButton().disabled).toBe(true)
      await change('host:80')
      expect(submitButton().disabled).toBe(false)
      await act(async () => close?.click())
      expect(onClose).toHaveBeenCalledOnce()
    },
  )
  it.each(['zh-CN', 'en-US'])(
    'preserves all safety notes in a focusable, non-submit format disclosure in %s',
    async (locale) => {
      window.localStorage.setItem('contextweave:locale', locale)
      await render()
      await change('host:80')
      const trigger = formatTrigger()
      expect(trigger.textContent).toBe(locale === 'zh-CN' ? '格式说明' : 'Format details')
      expect(trigger.tagName).toBe('BUTTON')
      expect(trigger.type).toBe('button')
      expect(trigger.tabIndex).toBe(0)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      await act(async () => trigger.focus())
      expect(document.activeElement).toBe(trigger)
      await act(async () => trigger.click())
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
      expect(panel?.getAttribute('data-slot')).toBe('collapsible-content')
      expect(panel?.closest('[hidden]')).toBeNull()
      const notes =
        locale === 'zh-CN'
          ? [
              'IPv6 地址需加方括号',
              'URI 凭据中的 @、:、#、%、/ 等特殊字符需百分号编码',
              '冒号分隔格式的凭据按原文保存，密码可含冒号，但含 @ 时须改用编码后的 URI',
              '有歧义的格式会被拒绝，不会猜测凭据',
              '相同协议、地址、端口和用户名会跳过，已有密码不会被覆盖',
            ]
          : [
              'bracket IPv6 addresses',
              'Percent-encode special characters such as @, :, #, % and / in URI credentials',
              'Colon-separated credentials stay literal, including colons in passwords; credentials containing @ must use an encoded URI instead',
              'Ambiguous formats are rejected, never guessed',
              'Existing protocol/host/port/username combinations are skipped without replacing passwords',
            ]
      for (const note of [
        'host:port',
        '[scheme://]user:password@host:port',
        '[scheme://]host:port:username:password',
        ...notes,
      ]) {
        expect(panel?.textContent).toContain(note)
      }
      await act(async () => trigger.click())
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      await eventually(() => expect(document.body.textContent).not.toContain('IPv6'))
      expect(document.activeElement).toBe(trigger)
      expect(importProxies).not.toHaveBeenCalled()
      expect(textarea().value).toBe('host:80')
      expect(onClose).not.toHaveBeenCalled()
    },
  )
  it.each(['zh-CN', 'en-US'])(
    'keeps redacted results visible outside collapsed help in %s',
    async (locale) => {
      window.localStorage.setItem('contextweave:locale', locale)
      await render()
      await change(source)
      await submit()
      await eventually(() =>
        expect(document.querySelector('[role="status"]')?.textContent).toContain(
          locale === 'zh-CN'
            ? '成功 1 项，失败 4 项，重复跳过 1 项'
            : 'Succeeded 1, failed 4, duplicates skipped 1',
        ),
      )
      const status = document.querySelector('[role="status"]')
      const list = document.querySelector('ul')
      expect(list?.querySelectorAll('li')).toHaveLength(4)
      expect(list?.getAttribute('aria-label')).toBe(
        locale === 'zh-CN' ? '失败代理（凭据已脱敏）' : 'Failed proxies (credentials redacted)',
      )
      expect(status?.textContent).toContain(
        locale === 'zh-CN'
          ? '输入已清空以保护凭据；失败代理仅显示脱敏信息，请修正后重新粘贴'
          : 'Input cleared to protect credentials; failed proxies are redacted. Correct and paste them again to retry',
      )
      for (const expanded of ['true', 'false']) {
        await act(async () => formatTrigger().click())
        expect(formatTrigger().getAttribute('aria-expanded')).toBe(expanded)
        expect(status?.isConnected).toBe(true)
        expect(list?.isConnected).toBe(true)
        expect(status?.closest('[data-slot="collapsible"], [hidden]')).toBeNull()
        expect(list?.closest('[data-slot="collapsible"], [hidden]')).toBeNull()
      }
      expect(textarea().value).toBe('')
      expect(document.body.innerHTML).not.toMatch(/private-user|private-password|unrecognized/)
    },
  )
  it('sends only text, shows all counts and failures with source line numbers, and clears credentials', async () => {
    await render()
    await change(source)
    await submit()
    await eventually(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
        '成功 1 项，失败 4 项，重复跳过 1 项',
      ),
    )
    expect(importProxies).toHaveBeenCalledExactlyOnceWith({ text: source })
    const list = document.querySelector('ul[aria-label="失败代理（凭据已脱敏）"]')
    expect(list?.querySelectorAll('li')).toHaveLength(4)
    expect(list?.textContent).toContain('第 3 行: http://***:***@refused.example:80')
    expect(list?.textContent).toContain('第 4 行: https://***:***@invalid.example:65536')
    expect(list?.textContent).toContain('第 5 行: socks5://***:***@[::1]:1080')
    expect(list?.textContent).toContain('第 7 行: 无法安全识别代理，原文已隐藏')
    expect(list?.textContent).toContain('系统安全存储不可用')
    expect(list?.textContent).toContain('格式无效或有歧义')
    expect(list?.textContent).toContain('保存失败')
    expect(textarea().value).toBe('')
    expect(document.body.innerHTML).not.toMatch(/private-user|private-password|unrecognized/)
    expect(submitButton().disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })
  it('shows zero successes for an all-failed batch, then replaces results on a corrected retry', async () => {
    importProxies.mockResolvedValueOnce({
      ok: true,
      data: mixed.filter((row) => row.status === 'error'),
    })
    await render()
    await change(source)
    await submit()
    await eventually(() =>
      expect(document.body.textContent).toContain('成功 0 项，失败 4 项，重复跳过 0 项'),
    )
    importProxies.mockResolvedValueOnce({
      ok: true,
      data: [{ line: 1, status: 'created', proxyId: 'retried' }],
    })
    await change('corrected.example:80')
    await submit()
    await eventually(() =>
      expect(document.body.textContent).toContain('成功 1 项，失败 0 项，重复跳过 0 项'),
    )
    expect(document.querySelector('ul')).toBeNull()
    expect(document.body.textContent).not.toContain('refused.example')
    expect(importProxies).toHaveBeenLastCalledWith({ text: 'corrected.example:80' })
  })
  it('reports repeated imports as skipped, not successes or failures', async () => {
    importProxies.mockResolvedValueOnce({
      ok: true,
      data: [{ line: 1, status: 'skipped', code: 'PROXY_ALREADY_EXISTS' }],
    })
    await render()
    await change('existing.example:80')
    await submit()
    await eventually(() =>
      expect(document.body.textContent).toContain('成功 0 项，失败 0 项，重复跳过 1 项'),
    )
    expect(document.querySelector('ul')).toBeNull()
    expect(textarea().value).toBe('')
  })
  it('guards duplicate submissions and close/Escape while Main owns the batch', async () => {
    let finish: ((value: IpcResult<ImportProxiesResult>) => void) | undefined
    importProxies.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await change(source)
    const form = textarea().closest('form')
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await eventually(() => expect(importProxies).toHaveBeenCalledOnce())
    expect(submitButton().disabled).toBe(true)
    expect(textarea().disabled).toBe(true)
    const close = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === '关闭',
    )
    expect(close?.disabled).toBe(true)
    await act(async () => {
      close?.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish?.({ ok: true, data: mixed }))
    await eventually(() => expect(textarea().disabled).toBe(false))
    await act(async () => close?.click())
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('validates batch limits locally and accepts 200 entries plus blank lines and a final newline', async () => {
    await render()
    await change('host:80\n'.repeat(201))
    await submit()
    expect(importProxies).not.toHaveBeenCalled()
    expect(textarea().getAttribute('aria-invalid')).toBe('true')
    expect(textarea().getAttribute('aria-describedby')).toContain('proxy-import-error')
    await change('x'.repeat(65537))
    await submit()
    expect(importProxies).not.toHaveBeenCalled()
    await change('\n host:80\r\n '.repeat(200))
    await submit()
    await eventually(() => expect(importProxies).toHaveBeenCalledOnce())
    expect(textarea().getAttribute('aria-invalid')).toBe('false')
  })
  it('does not display or automatically retry raw transport errors, and allows an explicit retry', async () => {
    importProxies.mockRejectedValueOnce(new Error('private transport secret'))
    await render()
    await change('host:80')
    await submit()
    await eventually(() => expect(document.querySelector('[role="alert"]')).not.toBeNull())
    expect(document.body.textContent).not.toContain('private transport secret')
    expect(importProxies).toHaveBeenCalledOnce()
    expect(textarea().value).toBe('host:80')
    expect(submitButton().disabled).toBe(false)
    await submit()
    await eventually(() => expect(importProxies).toHaveBeenCalledTimes(2))
  })
  it('ignores an old completion after unmount and removes inactive mutation variables', async () => {
    let finish: ((value: IpcResult<ImportProxiesResult>) => void) | undefined
    importProxies.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await change(source)
    await submit()
    await act(async () => root.render(null))
    await render()
    await act(async () => finish?.({ ok: true, data: mixed }))
    await eventually(() => expect(client.getMutationCache().getAll()).toHaveLength(0))
    expect(textarea().value).toBe('')
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
