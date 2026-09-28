// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EnvironmentTag, OrganizationSnapshot } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { workspaceKey } from '@/features/workspaces/workspace-session-context'
import { TestWorkspaceProvider } from '../../../../test-support/workspace-renderer'
import { fixtureWorkspace, withWorkspaceFixture } from '../../../../test-support/workspace'
import { TagsPage } from './tags-page'
import { TagEditorDialog } from './tag-editor-dialog'
import { TagDeleteDialog } from './tag-delete-dialog'
import { EnvironmentOrganizationDialog } from '../organization/environment-organization-dialog'
import { organizeEnvironments } from '../organization/use-organization'
import { tagUsage } from './tag-usage'
const tag: EnvironmentTag = {
  ...fixtureWorkspace,
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Review',
  revision: 1,
  updatedAt: '2026-09-28T00:00:00.000Z',
}
let snapshot: OrganizationSnapshot, client: QueryClient, container: HTMLDivElement, root: Root
vi.mock('@/components/ui/toast', () => ({ toast: { add: vi.fn() } }))
const removeMany = vi.fn()
const list = vi.fn(),
  create = vi.fn(),
  update = vi.fn(),
  remove = vi.fn(),
  save = vi.fn(),
  onClose = vi.fn(),
  onSaved = vi.fn()
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
async function render(element: ReactNode) {
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
function button(text: string, scope: ParentNode = document) {
  const value = [...scope.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text || button.getAttribute('aria-label') === text,
  )
  if (!value) throw new Error('Missing button: ' + text)
  return value
}
async function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function nameInput() {
  return document.querySelector<HTMLInputElement>('[role="dialog"] input')!
}
async function click(text: string, scope: ParentNode = document) {
  await act(async () => button(text, scope).click())
  await flush()
}
async function refresh() {
  await act(async () => {
    await client.invalidateQueries({ queryKey: workspaceKey(fixtureWorkspace, 'organization') })
  })
  await flush()
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  localStorage.setItem('contextweave:locale', 'en-US')
  for (const mock of [list, create, update, remove, removeMany, save, onClose, onSaved])
    mock.mockReset()
  snapshot = { ...fixtureWorkspace, tags: [tag], environments: [], views: [], groups: [] }
  list.mockImplementation(async () => ({ ok: true, data: snapshot }))
  vi.stubGlobal(
    'contextweave',
    withWorkspaceFixture({
      organization: {
        list,
        createTag: create,
        updateTag: update,
        deleteTag: remove,
        deleteTags: removeMany,
        saveEnvironment: save,
      },
    }),
  )
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
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
it('lists unused tags in the existing DataTable and uses its search and pagination', async () => {
  snapshot.tags = Array.from({ length: 23 }, (_, index) => ({
    ...tag,
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    name: `Tag ${String(index).padStart(2, '0')}`,
  }))
  await render(<TagsPage />)
  expect(document.querySelector('table')?.getAttribute('aria-label')).toBe('Tag management')
  expect(document.querySelectorAll('tbody tr')).toHaveLength(20)
  expect(document.querySelector('[data-slot="data-table-pagination"]')).not.toBeNull()
  await click('Next page')
  expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search tags…"]')!
  await fill(search, 'Tag 22')
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
  expect(document.querySelector('tbody')?.textContent).toContain('Tag 22')
  await fill(search, 'missing')
  expect(document.querySelector('tbody')?.textContent).toContain('No tags')
})
it('shows loading and safe retry states, then creates a standalone tag with success feedback', async () => {
  list.mockReturnValueOnce(new Promise(() => {}))
  await render(<TagsPage />)
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(button('New tag').disabled).toBe(true)
  await act(async () => {
    await client.cancelQueries({ queryKey: workspaceKey(fixtureWorkspace, 'organization') })
  })
  list.mockResolvedValueOnce({ ok: false, code: 'COMMAND_FAILED', message: '/private/db.sqlite' })
  await refresh()
  expect(document.body.textContent).not.toContain('/private/db.sqlite')
  expect(button('Retry')).toBeDefined()
  snapshot = { ...snapshot, tags: [] }
  await click('Retry')
  await click('New tag')
  await fill(nameInput(), ' Unused ')
  create.mockImplementation(async (input: { name: string }) => {
    const result = { ...tag, name: input.name }
    snapshot = { ...snapshot, tags: [result] }
    return { ok: true, data: result }
  })
  await click('Save tag')
  expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Unused' })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('tbody')?.textContent).toContain('Unused')
  expect(document.body.textContent).toContain('Tag created.')
})
it('validates blank/duplicate names locally, keeps failed drafts, and requires explicit reload after a CAS conflict', async () => {
  await render(<TagEditorDialog tag={tag} onClose={onClose} onSaved={onSaved} />)
  await fill(nameInput(), '  ')
  await click('Save tag')
  expect(nameInput().getAttribute('aria-invalid')).toBe('true')
  expect(update).not.toHaveBeenCalled()
  snapshot = {
    ...snapshot,
    tags: [tag, { ...tag, id: '00000000-0000-4000-8000-000000000011', name: 'Other' }],
  }
  await refresh()
  await fill(nameInput(), ' other ')
  await click('Save tag')
  expect(document.body.textContent).toContain('already exists')
  expect(update).not.toHaveBeenCalled()
  await fill(nameInput(), 'My draft')
  let finish!: (value: unknown) => void
  update.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => {
    button('Save tag').click()
    button('Save tag').click()
  })
  expect(update).toHaveBeenCalledExactlyOnceWith({
    id: tag.id,
    expectedRevision: 1,
    name: 'My draft',
  })
  expect(button('Cancel').disabled).toBe(true)
  await act(async () =>
    finish({ ok: false, code: 'ORGANIZATION_CONFLICT', message: 'private details' }),
  )
  expect(nameInput().value).toBe('My draft')
  expect(document.body.textContent).not.toContain('private details')
  expect(onSaved).not.toHaveBeenCalled()
  snapshot = { ...snapshot, tags: [{ ...tag, name: 'Remote edit', revision: 2 }] }
  await refresh()
  expect(nameInput().value).toBe('My draft')
  expect(button('Save tag').disabled).toBe(true)
  await click('Reload saved content')
  expect(nameInput().value).toBe('Remote edit')
  await fill(nameInput(), 'Final')
  update.mockResolvedValue({ ok: true, data: { ...tag, name: 'Final', revision: 3 } })
  await click('Save tag')
  expect(update).toHaveBeenLastCalledWith({ id: tag.id, expectedRevision: 2, name: 'Final' })
  expect(onSaved).toHaveBeenCalledOnce()
})
it('supports cancelling the editor without writes and refuses to submit a deleted tag', async () => {
  await render(<TagEditorDialog tag={tag} onClose={onClose} onSaved={onSaved} />)
  await fill(nameInput(), 'Not submitted')
  snapshot = { ...snapshot, tags: [] }
  await refresh()
  expect(document.body.textContent).toContain('This tag was deleted')
  expect(button('Save tag').disabled).toBe(true)
  await click('Cancel')
  expect(onClose).toHaveBeenCalledOnce()
  expect(update).not.toHaveBeenCalled()
})
it('requires destructive confirmation, preserves failed deletion for retry, and uses a reloaded revision', async () => {
  await render(<TagDeleteDialog tag={tag} onClose={onClose} onDeleted={onSaved} />)
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    'No environments or browser data will be deleted',
  )
  expect(remove).not.toHaveBeenCalled()
  remove.mockResolvedValueOnce({ ok: false, code: 'ORGANIZATION_CONFLICT', message: 'private' })
  await click('Delete tag')
  expect(remove).toHaveBeenCalledExactlyOnceWith({ id: tag.id, expectedRevision: 1 })
  expect(onSaved).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  snapshot = { ...snapshot, tags: [{ ...tag, name: 'Current', revision: 2 }] }
  await click('Reload saved content')
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Current')
  remove.mockResolvedValue({ ok: true, data: true })
  await click('Delete tag')
  expect(remove).toHaveBeenLastCalledWith({ id: tag.id, expectedRevision: 2 })
  expect(onSaved).toHaveBeenCalledOnce()
})
it('opens edit/delete from table actions and cancelling a delete never calls IPC', async () => {
  await render(<TagsPage />)
  await click('Rename tag')
  expect(nameInput().value).toBe('Review')
  await click('Cancel')
  await click('Delete tag')
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await click('Cancel', document.querySelector('[role="alertdialog"]')!)
  expect(remove).not.toHaveBeenCalled()
})
it('does not call a stale success callback after the workspace subtree unmounts', async () => {
  let finish!: (value: unknown) => void
  create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render(<TagEditorDialog onClose={onClose} onSaved={onSaved} />)
  await fill(nameInput(), 'Queued')
  await click('Save tag')
  await render(<p>Different workspace subtree</p>)
  await act(async () => finish({ ok: true, data: { ...tag, name: 'Queued' } }))
  expect(onSaved).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Different workspace subtree')
})
it('shares the unused tag dictionary with the existing environment editor, with keyboard selection', async () => {
  snapshot = {
    ...snapshot,
    tags: [{ ...tag, name: 'Unused' }],
    environments: [
      { ...fixtureWorkspace, environmentId: 'env', groupId: null, tags: [], note: '', revision: 0 },
    ],
  }
  const environment = organizeEnvironments(
    [
      {
        ...fixtureWorkspace,
        id: 'env',
        name: 'Environment',
        status: 'stopped',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        platform: 'darwin',
        arch: 'arm64',
        updatedAt: tag.updatedAt,
      },
    ],
    snapshot,
  )[0]!
  await render(<EnvironmentOrganizationDialog environment={environment} onClose={onClose} />)
  const picker = document.querySelector<HTMLInputElement>('input[role="combobox"]')!
  await fill(picker, 'Unused')
  await act(async () => {
    picker.focus()
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  await flush()
  const option = document.querySelector<HTMLElement>('[role="option"]')
  expect(option?.textContent).toContain('Unused')
  await act(async () =>
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  )
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Unused')
  save.mockResolvedValue({
    ok: true,
    data: { ...snapshot.environments[0], tags: ['Unused'], revision: 1 },
  })
  await click('Save organization')
  expect(save).toHaveBeenCalledExactlyOnceWith({
    environmentId: 'env',
    groupId: null,
    tags: ['Unused'],
    note: '',
    expectedRevision: 0,
  })
})
it('counts key-equivalent environment associations and saved filters against the one canonical dictionary', () => {
  snapshot = {
    ...snapshot,
    environments: [
      {
        ...fixtureWorkspace,
        environmentId: 'env',
        groupId: null,
        tags: ['REVIEW'],
        note: '',
        revision: 1,
      },
    ],
    views: [
      {
        ...tag,
        name: 'View',
        view: {
          version: 1,
          search: '',
          filters: { statuses: [], kernelIds: [], proxyIds: [], groupIds: [], tags: ['review'] },
          sorting: [],
          hiddenColumns: [],
        },
      },
    ],
  }
  const usage = tagUsage(snapshot)
  expect(usage.environments.get('review')).toBe(1)
  expect(usage.views.get('review')).toBe(1)
  expect(
    organizeEnvironments(
      [
        {
          ...fixtureWorkspace,
          id: 'env',
          name: 'Environment',
          status: 'stopped',
          kernelId: 'standard-chromium',
          kernelVersion: 'local',
          platform: 'darwin',
          arch: 'arm64',
          updatedAt: tag.updatedAt,
        },
      ],
      snapshot,
    )[0]?.tags,
  ).toEqual(['Review'])
})
it('renders the Chinese dictionary labels as well as English', async () => {
  localStorage.setItem('contextweave:locale', 'zh-CN')
  await render(<TagsPage />)
  expect(document.querySelector('table')?.getAttribute('aria-label')).toBe('标签管理')
  expect(button('新建标签')).toBeDefined()
})

it('selects tags, confirms only those revisions and keeps failed deletions selected', async () => {
  const other = { ...tag, id: '00000000-0000-4000-8000-000000000002', name: 'Other' }
  snapshot.tags = [tag, other]
  removeMany.mockImplementation(async () => {
    snapshot.tags = [other]
    return {
      ok: true,
      data: [
        { id: tag.id, ok: true },
        { id: other.id, ok: false, code: 'ORGANIZATION_CONFLICT' },
      ],
    }
  })
  await render(<TagsPage />)
  expect(container.querySelector('thead [data-actions]')?.textContent).toBe('Actions')
  expect(container.querySelector('tbody [data-actions] [role="group"]')?.className).toContain(
    'justify-end',
  )
  await act(async () => container.querySelector<HTMLElement>('thead [role="checkbox"]')!.click())
  await click('Delete selected', container)
  const dialog = document.querySelector('[role="alertdialog"]')!
  expect(dialog.textContent).toContain(tag.name)
  expect(dialog.textContent).toContain(other.name)
  await click('Delete selected', dialog)
  expect(removeMany).toHaveBeenCalledExactlyOnceWith([
    { id: tag.id, expectedRevision: tag.revision },
    { id: other.id, expectedRevision: other.revision },
  ])
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Other')
  expect(container.querySelector('tbody [role="checkbox"]')?.getAttribute('aria-checked')).toBe(
    'true',
  )
  expect(remove).not.toHaveBeenCalled()
})
