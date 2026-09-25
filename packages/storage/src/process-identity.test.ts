import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isProcessAlive, isRuntimeProcessAlive, readProcessIdentity } from './process-identity'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
const linuxStat = `123 (process with spaces) ${[...Array(19).fill('0'), '12345'].join(' ')}`
const identity =
  process.platform === 'win32'
    ? 'win32:123456789'
    : process.platform === 'darwin'
      ? 'darwin:Fri Sep 25 12:34:56 2026'
      : 'linux:boot-fixture:12345'

beforeEach(() => {
  vi.spyOn(process, 'kill').mockReturnValue(true)
  vi.mocked(execFileSync).mockReturnValue(
    process.platform === 'win32' ? '123456789\n' : 'Fri Sep 25 12:34:56 2026\n',
  )
  vi.mocked(readFileSync).mockImplementation((path) =>
    String(path).endsWith('/stat') ? linuxStat : 'boot-fixture\n',
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('process identity trust decisions', () => {
  it('reads OS start identity, matches the owner, and recognizes PID reuse', () => {
    expect(readProcessIdentity(123)).toBe(identity)
    if (process.platform === 'win32') {
      const [file, args, options] = vi.mocked(execFileSync).mock.calls[0]!
      expect(file).toMatch(/WindowsPowerShell.*powershell\.exe$/)
      expect(args).toContain(
        "$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(123).StartTime.ToUniversalTime().Ticks.ToString()",
      )
      expect(options).toMatchObject({ timeout: 5000, maxBuffer: 4096, windowsHide: true })
    }
    expect(isRuntimeProcessAlive(123, identity)).toBe(true)
    expect(isRuntimeProcessAlive(123, 'previous-process')).toBe(false)
  })
  it('treats missing permission and probe timeout as unknown, never proof of death', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' })
    })
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })
    expect(readProcessIdentity(123)).toBeUndefined()
    expect(isRuntimeProcessAlive(123, identity)).toBe(true)
  })
  it('does not treat malformed OS output as a different process', () => {
    vi.mocked(execFileSync).mockReturnValue('not-a-start-time')
    vi.mocked(readFileSync).mockReturnValue('invalid')
    expect(readProcessIdentity(123)).toBeUndefined()
    expect(isRuntimeProcessAlive(123, identity)).toBe(true)
  })
  it('preserves legacy live owners without probing a missing identity', () => {
    expect(isRuntimeProcessAlive(123)).toBe(true)
    expect(execFileSync).not.toHaveBeenCalled()
    expect(readFileSync).not.toHaveBeenCalled()
  })
  it('recognizes OS-confirmed death before probing identity', () => {
    vi.mocked(process.kill).mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    expect(isRuntimeProcessAlive(123, identity)).toBe(false)
    expect(execFileSync).not.toHaveBeenCalled()
    expect(readFileSync).not.toHaveBeenCalled()
  })
  it('does not confuse kill permission errors with an exited process', () => {
    vi.mocked(process.kill).mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    expect(isProcessAlive(123)).toBe(true)
  })
  it('rejects invalid PIDs without invoking OS commands', () => {
    for (const pid of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readProcessIdentity(pid)).toBeUndefined()
      expect(isProcessAlive(pid)).toBe(false)
    }
    expect(execFileSync).not.toHaveBeenCalled()
    expect(readFileSync).not.toHaveBeenCalled()
    expect(process.kill).not.toHaveBeenCalled()
  })
})
