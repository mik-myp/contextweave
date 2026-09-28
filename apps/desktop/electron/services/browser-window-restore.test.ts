import { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { restoreBrowserWindows } from './browser-window-restore'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn,
}))
const plan = {
  executablePath: '/fixture/browser',
  args: [
    '--user-data-dir=/fixture/profile',
    '--remote-debugging-pipe',
    '--no-startup-window',
    '--restore-last-session',
  ],
  userDataDir: '/fixture/profile',
  controlTransport: 'pipe' as const,
}
let child: ChildProcess
beforeEach(() => {
  vi.useFakeTimers()
  child = new ChildProcess()
  child.kill = vi.fn(() => true)
  spawn.mockReset().mockReturnValue(child)
})
afterEach(() => vi.useRealTimers())
it('forwards the verified plan without opening a second control endpoint', async () => {
  const pending = restoreBrowserWindows(plan, new AbortController().signal)
  expect(spawn).toHaveBeenCalledWith(
    plan.executablePath,
    ['--user-data-dir=/fixture/profile', '--restore-last-session'],
    { stdio: 'ignore', windowsHide: true },
  )
  child.emit('exit', 0)
  await pending
  expect(vi.getTimerCount()).toBe(0)
})
it('does not spawn after cancellation', async () => {
  await expect(restoreBrowserWindows(plan, AbortSignal.abort())).rejects.toThrow()
  expect(spawn).not.toHaveBeenCalled()
})
it.each(['abort', 'timeout'] as const)(
  'terminates and reaps a stuck handoff on %s',
  async (reason) => {
    const controller = new AbortController()
    const pending = restoreBrowserWindows(plan, controller.signal)
    const result = expect(pending).rejects.toThrow('BROWSER_RESTORE_FAILED')
    if (reason === 'abort') controller.abort()
    else await vi.advanceTimersByTimeAsync(10000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(1000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('exit', null, 'SIGKILL')
    await result
    expect(vi.getTimerCount()).toBe(0)
  },
)
it.each(['error', 'exit'])('sanitizes a failed handoff (%s)', async (event) => {
  const pending = restoreBrowserWindows(plan, new AbortController().signal)
  const result = expect(pending).rejects.toThrow('BROWSER_RESTORE_FAILED')
  if (event === 'error') child.emit('error', new Error('/private/path'))
  else child.emit('exit', 1)
  await result
  expect(vi.getTimerCount()).toBe(0)
})
