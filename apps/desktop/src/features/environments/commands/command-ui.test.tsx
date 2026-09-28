// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  environmentCommandReceiptSchema,
  type EnvironmentCommandReceipt,
  type EnvironmentCommandRequest,
  type EnvironmentRecoveryInspection,
  type WorkspaceContext,
} from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { fixtureWorkspace, withWorkspaceFixture } from '../../../../test-support/workspace'
import { EnvironmentRecoveryDialog } from './recovery-dialog'
import { PendingCommands } from './pending-commands'
import { EnvironmentCommands } from './environment-commands'
import { EnvironmentTrash } from '../components/environment-trash'
import { OrphanDirectories } from '@/features/settings/components/orphan-directories'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#fixture">{children}</a>,
}))
const at = '2026-01-01T00:00:00.000Z'
const id = '00000000-0000-4000-8000-000000000010'
const otherId = '00000000-0000-4000-8000-000000000011'
const journalKey = `contextweave:environment-commands:v1:${fixtureWorkspace.workspaceId}`
const request = {
  requestId: id,
  kind: 'start' as const,
  environmentId: 'env-a',
  expectedRevision: 1,
}
function receipt(
  input: EnvironmentCommandRequest = request,
  status: EnvironmentCommandReceipt['status'] = 'succeeded',
) {
  const target = input.kind === 'create' ? null : input.kind === 'update' ? input.input : input
  return environmentCommandReceiptSchema.parse({
    ...fixtureWorkspace,
    version: 1,
    requestId: input.requestId,
    kind: input.kind,
    environmentId: target?.environmentId ?? 'main-created',
    expectedRevision: target?.expectedRevision ?? null,
    status,
    createdAt: at,
    startedAt: ['queued', 'cancelled'].includes(status) ? null : at,
    endedAt: ['queued', 'running'].includes(status) ? null : at,
    errorCode:
      status === 'unknown'
        ? 'COMMAND_RESULT_UNKNOWN'
        : status === 'failed'
          ? 'CONFIG_CONFLICT'
          : status === 'cancelled'
            ? 'CANCELLED'
            : null,
  })
}
let root: Root, container: HTMLDivElement, cache: QueryClient
let inspection: EnvironmentRecoveryInspection
let current: EnvironmentCommandReceipt
const inspect = vi.fn(),
  submit = vi.fn(),
  lookup = vi.fn(),
  page = vi.fn(),
  cancel = vi.fn(),
  legacy = vi.fn(),
  close = vi.fn()
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
async function render(element: ReactNode, context: WorkspaceContext = fixtureWorkspace) {
  await act(async () =>
    root.render(
      <StrictMode>
        <I18nProvider>
          <QueryClientProvider client={cache}>
            <TestWorkspaceProvider key={context.workspaceId} context={context}>
              {element}
            </TestWorkspaceProvider>
          </QueryClientProvider>
        </I18nProvider>
      </StrictMode>,
    ),
  )
  await flush()
}
function button(text: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === text || node.textContent === text,
  )
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function click(text: string, scope: ParentNode = document) {
  await act(async () => button(text, scope).click())
  await flush()
}
function track() {
  window.localStorage.setItem(
    journalKey,
    JSON.stringify({ ...fixtureWorkspace, version: 1, entries: [{ ...request, createdAt: at }] }),
  )
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  window.localStorage.clear()
  inspection = {
    ...fixtureWorkspace,
    environmentId: 'env-a',
    revision: 3,
    status: 'needs-recovery',
    lifecycle: 'active',
    inspectedAt: at,
    ownedByThisApp: false,
    lockState: 'stale',
    recordedActiveSessions: 1,
    possiblyLiveSessions: 0,
    hasUnconfirmedCommand: true,
    canRecover: true,
    reason: null,
  }
  current = receipt()
  inspect.mockImplementation(async () => ({ ok: true, data: inspection }))
  submit.mockImplementation(async (input: EnvironmentCommandRequest) => ({
    ok: true,
    data: receipt(input),
  }))
  lookup.mockImplementation(async () => ({ ok: true, data: current }))
  page.mockImplementation(async () => ({
    ok: true,
    data: { ...fixtureWorkspace, items: [current], nextBeforeId: null },
  }))
  cancel.mockImplementation(async () => {
    current = receipt(request, 'cancelled')
    return { ok: true, data: current }
  })
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      environment: {
        inspectRecovery: inspect,
        submitCommand: submit,
        commandReceipt: lookup,
        commandPage: page,
        cancelCommand: cancel,
        activeCommands: async () => ({ ok: true, data: { ...fixtureWorkspace, items: [] } }),
        trash: async () => ({ ok: true, data: [] }),
        recover: legacy,
        stop: legacy,
      },
      storage: {
        orphans: async () => ({ ok: true, data: [{ name: 'unlinked-profile', modifiedAt: at }] }),
      },
    }),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  cache.clear()
  container.remove()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('explicit read-only recovery inspection', () => {
  it('shows inspection first and only submits the inspected revision after explicit confirmation', async () => {
    await render(<EnvironmentRecoveryDialog environmentId="env-a" onClose={close} />)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('0 / 1')
    expect(document.body.textContent).toContain('遗留锁')
    expect(submit).not.toHaveBeenCalled()
    expect(legacy).not.toHaveBeenCalled()
    await click('已核对，恢复管理状态')
    expect(submit).toHaveBeenCalledOnce()
    expect(submit.mock.calls[0][0]).toMatchObject({
      kind: 'recover',
      environmentId: 'env-a',
      expectedRevision: 3,
      requestId: expect.any(String),
    })
    expect(close).toHaveBeenCalledOnce()
    expect(legacy).not.toHaveBeenCalled()
  })
  it.each(['live', 'unreadable'] as const)(
    'does not offer recovery when a %s lock needs manual inspection',
    async (lockState) => {
      inspection = {
        ...inspection,
        lockState,
        canRecover: false,
        reason: lockState === 'live' ? 'RECOVERY_MANUAL_REQUIRED' : 'RECOVERY_LOCK_UNREADABLE',
      }
      await render(<EnvironmentRecoveryDialog environmentId="env-a" onClose={close} />)
      expect(button('已核对，恢复管理状态').disabled).toBe(true)
      await click('已核对，恢复管理状态')
      expect(submit).not.toHaveBeenCalled()
      expect(legacy).not.toHaveBeenCalled()
    },
  )
  it('keeps a conflicting recovery open until reinspection and never silently changes the submitted revision', async () => {
    submit.mockImplementationOnce(async (input: EnvironmentCommandRequest) => ({
      ok: true,
      data: receipt(input, 'failed'),
    }))
    await render(<EnvironmentRecoveryDialog environmentId="env-a" onClose={close} />)
    await click('已核对，恢复管理状态')
    expect(close).not.toHaveBeenCalled()
    expect(submit.mock.calls[0][0].expectedRevision).toBe(3)
    expect(document.body.textContent).toContain('修改')
    inspection = { ...inspection, revision: 4 }
    await click('查证原请求')
    await click('已核对，恢复管理状态')
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1][0].expectedRevision).toBe(4)
    expect(submit.mock.calls[1][0].requestId).not.toBe(submit.mock.calls[0][0].requestId)
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('pending identity verification and command receipts', () => {
  it.each(['unknown', 'missing'] as const)(
    'preserves %s across navigation and rechecks before manual acknowledgement, without replay',
    async (status) => {
      track()
      current = receipt(request, 'unknown')
      if (status === 'missing')
        lookup.mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'not found' })
      await render(<PendingCommands />)
      expect(document.body.textContent).toContain(id)
      const details = container.querySelector('details')!
      expect(details.open).toBe(false)
      expect(details.textContent).toContain(id)
      expect(details.querySelector('summary')?.textContent).toBe('诊断详情')
      expect(document.body.textContent).toContain(
        status === 'missing' ? '暂未找到回执' : '结果未知',
      )
      await render(null)
      await render(<PendingCommands />)
      expect(document.body.textContent).toContain(id)
      expect(submit).not.toHaveBeenCalled()
      const before = lookup.mock.calls.length
      await click('结束本地跟踪')
      expect(document.body.textContent).toContain('原请求仍可能稍后被接收')
      expect(window.localStorage.getItem(journalKey)).toContain(id)
      const dialog = document.querySelector('[role="alertdialog"]')!
      await click('结束本地跟踪', dialog)
      expect(lookup.mock.calls.length).toBe(before + 1)
      expect(JSON.parse(window.localStorage.getItem(journalKey)!).entries).toEqual([])
      expect(submit).not.toHaveBeenCalled()
      expect(cancel).not.toHaveBeenCalled()
    },
  )
  it('does not acknowledge active commands or expose unsafe raw lookup failures', async () => {
    track()
    current = receipt(request, 'running')
    await render(<PendingCommands />)
    expect(button('结束本地跟踪').disabled).toBe(true)
    lookup.mockRejectedValue(new Error('/private/token=secret'))
    await click('查证原请求')
    expect(document.body.textContent).toContain('结果尚未确认')
    expect(document.body.textContent).not.toContain('/private/')
    expect(submit).not.toHaveBeenCalled()
  })
  it('requires an explicit warning confirmation before resetting a corrupt local index', async () => {
    window.localStorage.setItem(journalKey, '{corrupt')
    await render(<PendingCommands />)
    expect(document.body.textContent).toContain('已禁止新的提交')
    await click('人工核对后重置本地索引')
    expect(window.localStorage.getItem(journalKey)).toBe('{corrupt')
    await click('人工核对后重置本地索引', document.querySelector('[role="alertdialog"]')!)
    expect(JSON.parse(window.localStorage.getItem(journalKey)!).entries).toEqual([])
    expect(submit).not.toHaveBeenCalled()
  })
  it('isolates journal entries on workspace remount and restores them when the original owner returns', async () => {
    track()
    await render(<PendingCommands />)
    expect(document.body.textContent).toContain(id)
    await render(<PendingCommands />, { workspaceId: otherId })
    expect(document.body.textContent).not.toContain(id)
    await render(<PendingCommands />)
    expect(document.body.textContent).toContain(id)
    expect(submit).not.toHaveBeenCalled()
  })
  it('cancels queued commands by their original identity, refreshes status and never offers unknown-result retry', async () => {
    current = receipt(request, 'queued')
    await render(<EnvironmentCommands />)
    await click('取消排队')
    expect(cancel).toHaveBeenCalledExactlyOnceWith(id)
    expect(document.body.textContent).toContain('已取消')
    current = receipt(request, 'unknown')
    await act(async () => {
      await cache.invalidateQueries()
    })
    await flush()
    expect(document.body.textContent).toContain('结果未知')
    expect([...document.querySelectorAll('button')].map((node) => node.textContent)).not.toContain(
      '重试',
    )
    expect(submit).not.toHaveBeenCalled()
  })
  it('uses bounded owned pagination rather than fetching all command history', async () => {
    page.mockImplementation(async ({ beforeId }: { beforeId: string | null }) => ({
      ok: true,
      data: {
        ...fixtureWorkspace,
        items: [receipt({ ...request, requestId: beforeId ? otherId : id })],
        nextBeforeId: beforeId ? null : id,
      },
    }))
    await render(<EnvironmentCommands />)
    expect(page).toHaveBeenCalledWith({ beforeId: null, limit: 20 })
    expect(container.querySelector('[data-slot="data-table-pagination"]')).not.toBeNull()
    expect(container.querySelectorAll('nav button')).toHaveLength(2)
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
    expect(button('上一页').disabled).toBe(true)
    await click('下一页')
    expect(page).toHaveBeenLastCalledWith({ beforeId: id, limit: 20 })
    expect(document.body.textContent).toContain(otherId)
    expect(button('下一页').disabled).toBe(true)
    await click('上一页')
    expect(document.body.textContent).toContain(id)
  })
})

it('shows owner, affected counts and sole-copy retention warnings without adding destructive controls', async () => {
  await render(
    <>
      <EnvironmentTrash onCreated={close} />
      <OrphanDirectories />
    </>,
  )
  expect(document.body.textContent).toContain(fixtureWorkspace.workspaceId)
  expect(document.body.textContent).toContain('共 0 个环境')
  expect(document.body.textContent).toContain('发现 1 个未关联目录')
  expect(document.body.textContent).toContain('可能是唯一副本')
  expect(document.body.textContent).toContain('不代表目录无用或可安全删除')
  expect(
    [...document.querySelectorAll('button')].some((node) =>
      /永久删除|自动恢复/.test(node.textContent ?? ''),
    ),
  ).toBe(false)
  expect(submit).not.toHaveBeenCalled()
})
