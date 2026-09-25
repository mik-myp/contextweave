// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { kernelSummarySchema, type IpcResult } from '@contextweave/contracts'
import { useKernelRemoval } from './use-kernel-removal'
const { refresh, setNotice, remove } = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  setNotice: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/app/use-app-data', () => ({ useAppData: () => ({ refresh, setNotice }) }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let state: ReturnType<typeof useKernelRemoval>
function Fixture() {
  state = useKernelRemoval()
  return (
    <output>
      {state.pending ? 'pending' : (state.error ?? state.selected?.label ?? 'closed')}
    </output>
  )
}
const kernel = kernelSummarySchema.parse({
  id: 'fingerprint-chromium',
  label: 'Test kernel',
  family: 'chromium',
  platform: 'darwin',
  arch: 'arm64',
  version: '148.0.0.1',
  status: 'available',
  packageAvailable: true,
  capabilities: {},
  capabilityReport: {},
  providerStatus: 'verified',
  removable: true,
  referenceCount: 1,
})
let root: Root, container: HTMLDivElement
let finish: (result: IpcResult<boolean>) => void
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'contextweave', {
    configurable: true,
    value: { kernel: { remove } },
  })
  remove.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Fixture />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it('requires confirmation, fences duplicate submit/dismiss and refreshes after success', async () => {
  await act(async () => state.select(kernel))
  expect(remove).not.toHaveBeenCalled()
  await act(async () => {
    void state.confirm()
    void state.confirm()
    state.select()
  })
  expect(remove).toHaveBeenCalledExactlyOnceWith(kernel.id)
  expect(state.selected).toBe(kernel)
  expect(state.pending).toBe(true)
  await act(async () => finish({ ok: true, data: true }))
  expect(state.selected).toBeUndefined()
  expect(state.pending).toBe(false)
  expect(setNotice).toHaveBeenCalledWith({ kind: 'success', message: 'kernel.removed' })
  expect(refresh).toHaveBeenCalledOnce()
})
it('keeps failures visible in the confirmation and permits retry', async () => {
  await act(async () => state.select(kernel))
  await act(async () => {
    void state.confirm()
  })
  await act(async () =>
    finish({ ok: false, code: 'KERNEL_REMOVE_FAILED', message: 'KERNEL_REMOVE_FAILED' }),
  )
  expect(state.error).toBeTruthy()
  expect(state.selected).toBe(kernel)
  expect(state.pending).toBe(false)
  expect(setNotice).not.toHaveBeenCalled()
  await act(async () => {
    void state.confirm()
  })
  expect(remove).toHaveBeenCalledTimes(2)
  await act(async () => finish({ ok: true, data: true }))
  expect(state.selected).toBeUndefined()
})
it('cancelling the dialog makes no deletion request', async () => {
  await act(async () => state.select(kernel))
  await act(async () => state.select())
  await act(async () => state.confirm())
  expect(remove).not.toHaveBeenCalled()
})
