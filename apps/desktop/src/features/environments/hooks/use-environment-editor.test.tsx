// @vitest-environment jsdom
import { act, StrictMode, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { environmentDetailsSchema } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import type { EnvironmentDraft } from '../environment-draft-context'
import { environmentFormDefaults } from '../environment-form'
import { environmentService } from '../environment-service'
import { useEnvironmentEditor } from './use-environment-editor'

const {
  drafts,
  navigate,
  setResumeId,
  setSavedId,
  refresh,
  setNotice,
  upsertEnvironment,
  appState,
} = vi.hoisted(() => ({
  drafts: new Map<string, EnvironmentDraft>(),
  navigate: vi.fn().mockResolvedValue(undefined),
  setResumeId: vi.fn(),
  setSavedId: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  setNotice: vi.fn(),
  upsertEnvironment: vi.fn(),
  appState: { loading: false, configurationError: undefined as string | undefined },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useBlocker: () => ({}),
}))
vi.mock('../environment-draft-context', () => ({
  useEnvironmentDrafts: () => ({ drafts, setResumeId, setSavedId }),
}))
vi.mock('@/app/use-app-data', () => ({
  useAppData: () => ({
    kernels: [{ id: 'standard-chromium', status: 'available' }],
    proxies: [],
    environments: [],
    refresh,
    setNotice,
    upsertEnvironment,
    ...appState,
  }),
}))
let hook: ReturnType<typeof useEnvironmentEditor>
function Fixture() {
  const value = useEnvironmentEditor()
  useLayoutEffect(() => {
    hook = value
  })
  return (
    <form onSubmit={value.submit}>
      <input aria-label="Name" {...value.form.register('name')} />
      <output>{value.error ?? value.form.formState.errors.name?.message}</output>
      <button type="submit" disabled={value.disabled}>
        Save
      </button>
    </form>
  )
}
const defaults = { ...environmentFormDefaults(), name: 'Initial', kernelId: 'standard-chromium' }
const saved = environmentDetailsSchema.parse({
  workspaceId: '00000000-0000-4000-8000-000000000001',
  id: 'env-saved',
  name: 'Saved',
  kernelId: 'standard-chromium',
  kernelVersion: 'local',
  status: 'stopped',
  platform: 'darwin',
  arch: 'arm64',
  updatedAt: '2026-09-27T00:00:00.000Z',
  browserSettings: { language: 'system', timezone: 'system', window: { width: 1440, height: 900 } },
})
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  drafts.clear()
  drafts.set('new', { values: { ...defaults }, defaults: { ...defaults } })
  appState.loading = false
  appState.configurationError = undefined
  vi.spyOn(environmentService, 'save').mockResolvedValue(saved)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const render = async () =>
  act(async () =>
    root.render(
      <StrictMode>
        <I18nProvider>
          <Fixture />
        </I18nProvider>
      </StrictMode>,
    ),
  )
const changeName = async (name: string) =>
  act(async () => {
    const input = container.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
it('subscribes to changed draft values once and unsubscribes on unmount', async () => {
  const store = vi.spyOn(drafts, 'set')
  await render()
  store.mockClear()
  await changeName('Edited')
  expect(drafts.get('new')?.values.name).toBe('Edited')
  expect(drafts.get('new')?.defaults.name).toBe('Initial')
  expect(store).toHaveBeenCalledOnce()
  const form = hook.form
  await act(async () => root.render(null))
  store.mockClear()
  await act(async () => {
    await form
      .register('name')
      .onChange({ target: { name: 'name', value: 'Detached' }, type: 'change' })
  })
  expect(store).not.toHaveBeenCalled()
})
it('validates on submit, prevents concurrent saves and clears the draft only after success', async () => {
  await render()
  await changeName('')
  await act(async () => {
    await hook.submit()
  })
  expect(environmentService.save).not.toHaveBeenCalled()
  expect(hook.form.formState.errors.name).toBeDefined()
  await changeName('Valid')
  let resolve!: (value: typeof saved) => void
  vi.mocked(environmentService.save).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes
    }),
  )
  let first!: Promise<void>
  await act(async () => {
    first = hook.submit()
    void hook.submit()
  })
  expect(environmentService.save).toHaveBeenCalledOnce()
  expect(drafts.get('new')?.values.name).toBe('Valid')
  await act(async () => {
    resolve(saved)
    await first
  })
  expect(drafts.has('new')).toBe(false)
  expect(setSavedId).toHaveBeenCalledWith('env-saved')
  expect(navigate).toHaveBeenCalledWith({ to: '/environments' })
  expect(upsertEnvironment).toHaveBeenCalledWith(saved)
})
it('keeps an editable draft after save failure and guards unavailable configuration', async () => {
  vi.mocked(environmentService.save).mockRejectedValueOnce(new Error('SAVE_FAILED'))
  await render()
  await changeName('Keep me')
  await act(async () => {
    await hook.submit()
  })
  expect(container.textContent).toContain('SAVE_FAILED')
  expect(drafts.get('new')?.values.name).toBe('Keep me')
  expect(navigate).not.toHaveBeenCalled()
  appState.configurationError = 'Configuration offline'
  await render()
  await act(async () => {
    await hook.submit()
  })
  expect(environmentService.save).toHaveBeenCalledOnce()
  expect(hook.disabled).toBe(true)
})
