// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OrganizationSnapshot } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { useDataTable } from '@/components/data-table/use-data-table'
import { workspaceKey } from '@/features/workspaces/workspace-session-context'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { fixtureWorkspace, withWorkspaceFixture } from '../../../../test-support/workspace'
import { EnvironmentOrganizationDialog } from './environment-organization-dialog'
import { GroupManagerDialog } from './group-manager-dialog'
import { SavedViewsDialog } from './saved-views-dialog'
import { captureEnvironmentView, applyEnvironmentView } from './view-state'
import { organizeEnvironments, type OrganizedEnvironment } from './use-organization'
const groupId = '00000000-0000-4000-8000-000000000010',
  viewId = '00000000-0000-4000-8000-000000000020'
const row: OrganizedEnvironment = {
  ...fixtureWorkspace,
  id: 'same-id',
  name: 'Fixture environment',
  status: 'stopped',
  kernelId: 'standard-chromium',
  kernelVersion: 'local',
  platform: 'darwin',
  arch: 'arm64',
  updatedAt: '2026-09-27T00:00:00.000Z',
  groupId: null,
  groupName: '',
  tags: [],
  note: '',
  organizationRevision: 0,
}
let root: Root, container: HTMLDivElement, client: QueryClient, snapshot: OrganizationSnapshot
const save = vi.fn(),
  createGroup = vi.fn(),
  deleteGroup = vi.fn(),
  createView = vi.fn(),
  deleteView = vi.fn(),
  onClose = vi.fn()
let table: ReturnType<typeof useDataTable<OrganizedEnvironment>>
function ViewHarness() {
  const value = useDataTable({
    data: [row],
    getRowId: (r) => r.id,
    columns: [
      { accessorKey: 'name', enableHiding: false },
      { accessorKey: 'status' },
      { accessorKey: 'kernelId' },
      { accessorKey: 'proxyId' },
      { accessorKey: 'groupId' },
      { accessorKey: 'tags' },
      { accessorKey: 'note' },
      { accessorKey: 'updatedAt' },
    ],
    enableRowSelection: true,
  })
  useLayoutEffect(() => {
    table = value
  })
  return <SavedViewsDialog table={value} onClose={onClose} />
}
const flush = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
async function render(element: React.ReactNode) {
  await act(async () =>
    root.render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <TestWorkspaceProvider>{element}</TestWorkspaceProvider>
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
  await flush()
}
const button = (text: string) => {
  const b = [...document.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!b) throw new Error('Missing button ' + text)
  return b
}
async function fill(label: string, text: string) {
  const fieldLabel = [...document.querySelectorAll('label')].find((l) => l.textContent === label)
  const input = fieldLabel ? document.getElementById(fieldLabel.htmlFor) : null
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement))
    throw new Error('Missing field ' + label)
  await act(async () => {
    const prototype =
      input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  for (const mock of [save, createGroup, deleteGroup, createView, deleteView, onClose])
    mock.mockReset()
  snapshot = {
    ...fixtureWorkspace,
    groups: [],
    tags: [],
    environments: [
      {
        ...fixtureWorkspace,
        environmentId: row.id,
        groupId: null,
        tags: [],
        note: '',
        revision: 0,
      },
    ],
    views: [],
  }
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      organization: {
        list: async () => ({ ok: true, data: snapshot }),
        saveEnvironment: save,
        createGroup,
        deleteGroup,
        createView,
        deleteView,
      },
    }),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})
it('validates tags locally, preserves failed edits and submits only once with the captured revision', async () => {
  await render(<EnvironmentOrganizationDialog environment={row} onClose={onClose} />)
  await fill('标签', 'Review\nreview')
  await act(async () => button('保存组织信息').click())
  expect(save).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('避免空名称与重复标签')
  await fill('标签', 'Review\n中文')
  await fill('备注', '<script>plain text</script>')
  let resolve!: (value: unknown) => void
  save.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await act(async () => {
    button('保存组织信息').click()
    button('保存组织信息').click()
  })
  expect(save).toHaveBeenCalledExactlyOnceWith({
    environmentId: row.id,
    groupId: null,
    tags: ['Review', '中文'],
    note: '<script>plain text</script>',
    expectedRevision: 0,
  })
  await act(async () =>
    resolve({ ok: false, code: 'ORGANIZATION_CONFLICT', message: 'private backend message' }),
  )
  expect(document.body.textContent).toContain('请先重新加载')
  expect(document.body.textContent).not.toContain('private backend message')
  expect([...document.querySelectorAll('textarea')][1]?.value).toBe('<script>plain text</script>')
  expect(onClose).not.toHaveBeenCalled()
  snapshot = {
    ...snapshot,
    environments: [{ ...snapshot.environments[0]!, revision: 2, note: 'New authoritative note' }],
  }
  await act(async () => button('重新加载已保存的内容').click())
  await flush()
  expect([...document.querySelectorAll('textarea')][1]?.value).toBe('New authoritative note')
  save.mockResolvedValue({ ok: true, data: { ...snapshot.environments[0], revision: 3 } })
  await act(async () => button('保存组织信息').click())
  await flush()
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 2 }))
  expect(onClose).toHaveBeenCalledOnce()
})
it('keeps a duplicate group name editable, and requires confirmation before ungrouping environments', async () => {
  createGroup.mockResolvedValue({
    ok: false,
    code: 'ORGANIZATION_NAME_EXISTS',
    message: 'not shown',
  })
  await render(<GroupManagerDialog onClose={onClose} />)
  await fill('新建分组', 'Existing')
  await act(async () => button('新建分组').click())
  await flush()
  expect(document.body.textContent).toContain('此名称已存在')
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('Existing')
  snapshot = {
    ...snapshot,
    groups: [
      { ...fixtureWorkspace, id: groupId, name: 'Group', revision: 1, updatedAt: row.updatedAt },
    ],
  }
  await act(async () =>
    client.invalidateQueries({ queryKey: workspaceKey(fixtureWorkspace, 'organization') }),
  )
  await flush()
  await act(async () => button('删除').click())
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('标签与备注保留')
  expect(deleteGroup).not.toHaveBeenCalled()
  await act(async () => button('取消').click())
  expect(deleteGroup).not.toHaveBeenCalled()
  await act(async () => button('删除').click())
  deleteGroup.mockResolvedValue({ ok: true, data: true })
  await act(async () => {
    const dialog = document.querySelector('[role="alertdialog"]')!
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '删除')!
    confirm.click()
  })
  await flush()
  expect(deleteGroup).toHaveBeenCalledExactlyOnceWith({ id: groupId, expectedRevision: 1 })
})
it('saves only view preferences, applies visible columns and filters while clearing current selection', async () => {
  await render(<ViewHarness />)
  await act(async () => {
    table.setRowSelection({ 'same-id': true })
    table.setGlobalFilter('Fixture')
    table.setColumnVisibility({ note: false })
    table.setSorting([{ id: 'name', desc: false }])
  })
  const captured = captureEnvironmentView(table)
  expect(captured).not.toHaveProperty('rowSelection')
  expect(captured).not.toHaveProperty('pagination')
  createView.mockImplementation(async (input) => ({
    ok: true,
    data: {
      ...fixtureWorkspace,
      id: viewId,
      name: input.name,
      view: input.view,
      revision: 1,
      updatedAt: row.updatedAt,
    },
  }))
  await fill('视图名称', 'Focused')
  await act(async () => button('保存当前视图').click())
  await flush()
  expect(createView).toHaveBeenCalledExactlyOnceWith({ name: 'Focused', view: captured })
  snapshot = {
    ...snapshot,
    views: [
      {
        ...fixtureWorkspace,
        id: viewId,
        name: 'Saved',
        view: {
          ...captured,
          search: '',
          hiddenColumns: ['tags'],
          filters: { ...captured.filters, groupIds: [groupId] },
        },
        revision: 1,
        updatedAt: row.updatedAt,
      },
    ],
  }
  await act(async () =>
    client.invalidateQueries({ queryKey: workspaceKey(fixtureWorkspace, 'organization') }),
  )
  await flush()
  await act(async () => button('应用视图').click())
  expect(table.state.rowSelection).toEqual({})
  expect(table.state.pagination.pageIndex).toBe(0)
  expect(table.state.columnVisibility).toEqual({ tags: false })
  expect(table.state.columnFilters).toEqual([{ id: 'groupId', value: [groupId] }])
  expect(onClose).toHaveBeenCalledOnce()
  // A removed group stays an explicit filter, never silently broadening the list.
  expect(captureEnvironmentView(table).filters.groupIds).toEqual([groupId])
  expect(() => applyEnvironmentView(table, { ...captured, hiddenColumns: ['name'] })).toThrow()
})
it('merges metadata without rewriting profile revisions or interpreting notes as markup', () => {
  const organized = organizeEnvironments([{ ...row, revision: 7 }], {
    ...snapshot,
    environments: [
      { ...snapshot.environments[0]!, revision: 3, note: '<b>plain</b>', tags: ['Label'] },
    ],
  })
  expect(organized[0]).toMatchObject({
    revision: 7,
    organizationRevision: 3,
    note: '<b>plain</b>',
    tags: ['Label'],
  })
})
