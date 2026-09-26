import { ChildProcess, execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readProcessIdentityAsync } from './process-identity-async'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
const linuxStat = `123 (process with spaces) ${[...Array(19).fill('0'), '12345'].join(' ')}`

beforeEach(() => {
  vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
    callback?.(
      null,
      process.platform === 'win32' ? '123456789\n' : 'Fri Sep 25 12:34:56 2026\n',
      '',
    )
    return new ChildProcess()
  })
  vi.mocked(readFile).mockImplementation(async (path) =>
    String(path).endsWith('/stat') ? linuxStat : 'boot-fixture\n',
  )
})
afterEach(() => vi.resetAllMocks())

describe('cancellable OS identity probe', () => {
  it('preserves the existing platform identity format without blocking the event loop', async () => {
    const signal = new AbortController().signal
    const expected =
      process.platform === 'win32'
        ? 'win32:123456789'
        : process.platform === 'darwin'
          ? 'darwin:Fri Sep 25 12:34:56 2026'
          : 'linux:boot-fixture:12345'
    expect(await readProcessIdentityAsync(123, signal)).toBe(expected)
    if (process.platform === 'linux') {
      expect(readFile).toHaveBeenCalledWith('/proc/123/stat', { encoding: 'utf8', signal })
    } else {
      const [file, args, options] = vi.mocked(execFile).mock.calls[0]!
      expect(options).toMatchObject({
        signal,
        encoding: 'utf8',
        maxBuffer: 4096,
        timeout: process.platform === 'win32' ? 5000 : 2000,
      })
      if (process.platform === 'win32') {
        expect(file).toMatch(/WindowsPowerShell.*powershell\.exe$/)
        expect(args).toContain(
          "$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(123).StartTime.ToUniversalTime().Ticks.ToString()",
        )
        expect(options).toMatchObject({ windowsHide: true })
      } else {
        expect(file).toBe('/bin/ps')
        expect(args).toEqual(['-p', '123', '-o', 'lstart='])
        expect(options).toMatchObject({ env: { LC_ALL: 'C', TZ: 'UTC' } })
      }
    }
  })
  it.each(['ETIMEDOUT', 'EACCES', 'ESRCH'])(
    'leaves %s failures unknown instead of inventing an identity',
    async (code) => {
      const error = Object.assign(new Error('probe failed'), { code })
      vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
        callback?.(error, '', '')
        return new ChildProcess()
      })
      vi.mocked(readFile).mockRejectedValue(error)
      expect(await readProcessIdentityAsync(123)).toBeUndefined()
    },
  )
  it('rejects malformed output', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      callback?.(null, 'not-a-start-identity', '')
      return new ChildProcess()
    })
    vi.mocked(readFile).mockResolvedValue('invalid')
    expect(await readProcessIdentityAsync(123)).toBeUndefined()
  })
  it('propagates cancellation instead of treating it as a retryable unknown identity', async () => {
    const controller = new AbortController()
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      controller.abort(new Error('cancelled'))
      callback?.(new Error('aborted'), '', '')
      return new ChildProcess()
    })
    vi.mocked(readFile).mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      throw new Error('aborted')
    })
    await expect(readProcessIdentityAsync(123, controller.signal)).rejects.toThrow('cancelled')
  })
  it('does not start commands for cancelled calls or invalid PIDs', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(readProcessIdentityAsync(123, controller.signal)).rejects.toThrow('cancelled')
    for (const pid of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(await readProcessIdentityAsync(pid)).toBeUndefined()
    expect(execFile).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })
})
