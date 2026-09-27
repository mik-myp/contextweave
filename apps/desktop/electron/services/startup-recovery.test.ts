import { describe, expect, it, vi } from 'vitest'
import { classifyStartupError, recoverStartup, startupFailureMessage } from './startup-recovery'

describe('safe startup recovery', () => {
  it.each([
    [Object.assign(new Error('secret SQL path'), { errcode: 26 }), 'DATABASE_CORRUPT'],
    [{ errcode: 267 }, 'DATABASE_CORRUPT'],
    [{ code: 'EACCES' }, 'DATA_ACCESS_DENIED'],
    [{ errcode: 8 }, 'DATA_ACCESS_DENIED'],
    [{ errcode: 14 }, 'DATA_ACCESS_DENIED'],
    [{ code: 'ENOSPC' }, 'DISK_FULL'],
    [{ errcode: 13 }, 'DISK_FULL'],
    [{ errcode: 5 }, 'DATA_BUSY'],
    [{ code: 'EIO' }, 'DATA_IO_FAILED'],
    [
      new Error('This database requires a newer ContextWeave version'),
      'DATABASE_VERSION_UNSUPPORTED',
    ],
    [new Error('UI_LOAD_FAILED'), 'UI_LOAD_FAILED'],
    [new Error('DATABASE_INTEGRITY_FAILED'), 'DATABASE_INTEGRITY_FAILED'],
    [new Error('DATABASE_SCHEMA_UNSUPPORTED'), 'DATABASE_SCHEMA_UNSUPPORTED'],
    [new Error('DATABASE_FOREIGN_KEYS_UNAVAILABLE'), 'DATABASE_FOREIGN_KEYS_UNAVAILABLE'],
    [new Error('password=secret /private/db.sqlite'), 'INITIALIZATION_FAILED'],
    [null, 'INITIALIZATION_FAILED'],
  ] as const)('maps structured failure %# without raw details', (error, code) => {
    expect(classifyStartupError(error)).toBe(code)
    const message = JSON.stringify(startupFailureMessage(classifyStartupError(error), 'zh-CN'))
    expect(message).not.toMatch(/secret|private|password=/)
  })
  it('offers inspection and a restart, never an in-process database reset', async () => {
    const show = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const openDataFolder = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret'))
      .mockResolvedValue(true)
    expect(
      await recoverStartup({ error: { errcode: 26 }, locale: 'zh-CN', show, openDataFolder }),
    ).toBe('restart')
    expect(openDataFolder).toHaveBeenCalledTimes(2)
    expect(show.mock.calls.map((call) => call[1])).toEqual([false, true, false])
    expect(JSON.stringify(show.mock.calls)).not.toContain('secret')
  })
  it('treats a dismissed or unavailable dialog as exit, not automatic retry', async () => {
    const openDataFolder = vi.fn()
    for (const show of [
      vi.fn().mockResolvedValue(2),
      vi.fn().mockRejectedValue(new Error('no UI')),
    ]) {
      expect(await recoverStartup({ error: null, locale: 'en-US', show, openDataFolder })).toBe(
        'exit',
      )
    }
    expect(openDataFolder).not.toHaveBeenCalled()
  })
})

it('reports invalid workspace ownership without suggesting replacement or exposing the data path', () => {
  expect(classifyStartupError(new Error('DATABASE_WORKSPACE_INVALID'))).toBe(
    'DATABASE_WORKSPACE_INVALID',
  )
  expect(JSON.stringify(startupFailureMessage('DATABASE_WORKSPACE_INVALID', 'zh-CN'))).toContain(
    '不会自动生成新身份',
  )
  expect(JSON.stringify(startupFailureMessage('DATABASE_WORKSPACE_INVALID', 'en-US'))).toContain(
    'no replacement identity',
  )
})
