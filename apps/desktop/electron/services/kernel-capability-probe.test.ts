import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import { z } from 'zod'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { kernelCapabilitiesSchema } from '@contextweave/contracts'
import { checkKernelCapabilities } from './kernel-capability-checks'
import { probeKernelCapabilities } from './kernel-capability-probe'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))
vi.mock('./kernel-capability-checks', () => ({ checkKernelCapabilities: vi.fn() }))
const capabilities = kernelCapabilitiesSchema.parse({
  cdp: true,
  screenshot: true,
  fileUpload: true,
  elementScreenshot: true,
  userAgent: true,
  timezone: true,
  proxy: true,
  webRtcPolicy: true,
})
const result = {
  version: 'Chrome/123.0.0.1',
  checkedAt: '2026-09-28T00:00:00Z',
  report: { cdp: { declared: true, state: 'verified' as const } },
}
let child: ChildProcess
function temporaryRoot() {
  const args = z.array(z.string()).parse(vi.mocked(spawn).mock.calls[0]?.[1])
  return dirname(
    args.find((arg) => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length),
  )
}
beforeEach(() => {
  child = new ChildProcess()
  Object.defineProperty(child, 'pid', { value: 12345 })
  // Model native read-only process state without starting or signalling a real process.
  Object.defineProperty(child, 'stdio', {
    value: [null, null, null, new PassThrough(), new PassThrough()],
  })
  vi.spyOn(child, 'kill').mockImplementation((signal) => {
    Object.defineProperty(child, 'exitCode', { value: 0, configurable: true })
    queueMicrotask(() => child.emit('exit', 0, signal))
    return true
  })
  vi.mocked(spawn).mockReturnValue(child)
  vi.mocked(checkKernelCapabilities).mockResolvedValue(result)
})
afterEach(() => {
  if (vi.mocked(spawn).mock.calls.length) rmSync(temporaryRoot(), { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
it('launches a disposable sandboxed profile through a private pipe and cleans it after detection', async () => {
  expect(
    await probeKernelCapabilities('/fixture/browser', capabilities, new AbortController().signal),
  ).toEqual(result)
  const args = z.array(z.string()).parse(vi.mocked(spawn).mock.calls[0][1])
  expect(args).toContain('--remote-debugging-pipe')
  expect(args).toContain('--proxy-bypass-list=<-loopback>')
  expect(args).not.toContain('--no-sandbox')
  expect(args.some((arg) => arg.startsWith('--remote-debugging-port'))).toBe(false)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(existsSync(temporaryRoot())).toBe(false)
})
it('cancels an in-flight check and still terminates and removes only its temporary profile', async () => {
  vi.mocked(checkKernelCapabilities).mockImplementation(
    async (_capabilities, _send, _file, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  const controller = new AbortController()
  const pending = probeKernelCapabilities('/fixture/browser', capabilities, controller.signal)
  const assertion = expect(pending).rejects.toThrow('CANCELLED')
  await vi.waitFor(() => expect(checkKernelCapabilities).toHaveBeenCalled())
  controller.abort()
  await assertion
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(existsSync(temporaryRoot())).toBe(false)
})
it('redacts protocol failures and cleans the child even when detection throws a local path', async () => {
  vi.mocked(checkKernelCapabilities).mockRejectedValue(new Error('/private/fixture/secret'))
  await expect(
    probeKernelCapabilities('/fixture/browser', capabilities, new AbortController().signal),
  ).rejects.toThrow(/^KERNEL_PROBE_FAILED$/)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(existsSync(temporaryRoot())).toBe(false)
})
it('fails closed and preserves the profile if the child cannot be confirmed stopped', async () => {
  vi.mocked(child.kill).mockReturnValue(false)
  await expect(
    probeKernelCapabilities('/fixture/browser', capabilities, new AbortController().signal),
  ).rejects.toThrow('KERNEL_PROBE_CLEANUP_FAILED')
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  expect(existsSync(temporaryRoot())).toBe(true)
})
it('does not start any process when already cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    probeKernelCapabilities('/fixture/browser', capabilities, controller.signal),
  ).rejects.toThrow()
  expect(spawn).not.toHaveBeenCalled()
})
