// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { environmentDetailsSchema, type EnvironmentDetails } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { EnvironmentConfigPage } from './environment-config-page'
import { environmentService } from '../environment-service'

vi.mock('../environment-service', () => ({ environmentService: { get: vi.fn() } }))
vi.mock('../components/environment-editor', () => ({
  EnvironmentEditor: ({ detail }: { detail?: EnvironmentDetails }) => (
    <output>{detail?.name ?? 'new environment'}</output>
  ),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
function details(id: string) {
  return environmentDetailsSchema.parse({
    id,
    name: `Loaded ${id}`,
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    status: 'stopped',
    platform: 'darwin',
    arch: 'arm64',
    updatedAt: '2026-09-27T00:00:00.000Z',
    browserSettings: {
      language: 'system',
      timezone: 'system',
      window: { width: 1440, height: 900 },
    },
  })
}
function deferred() {
  let resolve!: (value: EnvironmentDetails) => void
  let reject!: (error: Error) => void
  const promise = new Promise<EnvironmentDetails>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  container.dataset.scrollRestoration = 'true'
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const render = async (environmentId?: string) =>
  act(async () => {
    root.render(
      <I18nProvider>
        <EnvironmentConfigPage environmentId={environmentId} />
      </I18nProvider>,
    )
  })
it('ignores old responses after a route change and resets scroll without displaying the wrong editor', async () => {
  const a = deferred(),
    b = deferred()
  vi.mocked(environmentService.get).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
  container.scrollTop = 400
  await render('env-a')
  expect(container.scrollTop).toBe(0)
  await render('env-b')
  await act(async () => a.resolve(details('env-a')))
  expect(container.querySelector('output')).toBeNull()
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  await act(async () => b.resolve(details('env-b')))
  expect(container.textContent).toContain('Loaded env-b')
})
it('does not resurrect an earlier loaded editor when returning through an unresolved route', async () => {
  const b = deferred(),
    latestA = deferred()
  vi.mocked(environmentService.get)
    .mockResolvedValueOnce(details('env-a'))
    .mockReturnValueOnce(b.promise)
    .mockReturnValueOnce(latestA.promise)
  await render('env-a')
  expect(container.textContent).toContain('Loaded env-a')
  await render('env-b')
  await render('env-a')
  expect(container.querySelector('output')).toBeNull()
  await act(async () => b.reject(new Error('late B failure')))
  expect(container.textContent).not.toContain('late B failure')
  await act(async () => latestA.resolve({ ...details('env-a'), name: 'New revision' }))
  expect(container.textContent).toContain('New revision')
})
it('clears a failed attempt during retry and switches to create mode without stale errors', async () => {
  const retry = deferred()
  vi.mocked(environmentService.get)
    .mockRejectedValueOnce(new Error('Load failed'))
    .mockReturnValueOnce(retry.promise)
  await render('env-a')
  expect(container.textContent).toContain('Load failed')
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  expect(container.textContent).not.toContain('Load failed')
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  await render()
  expect(container.textContent).toContain('new environment')
  await act(async () => retry.resolve(details('env-a')))
  expect(container.textContent).toContain('new environment')
  expect(environmentService.get).toHaveBeenCalledTimes(2)
})
