import { describe, expect, it, vi } from 'vitest'
import { appLogEntrySchema, appLogSnapshotSchema } from '@contextweave/contracts'
import { createAppLogService } from './app-log-service'
import { createAppLogHandlers } from '../app-log-ipc'
import { fail, ok } from './result'

const startup = { level: 'info', source: 'app', event: 'app-started', fields: {} } as const

describe('application log buffer', () => {
  it('retains the newest entries in sequence and returns independent snapshots', () => {
    const logs = createAppLogService(2)
    logs.record(startup)
    const original = logs.snapshot()
    logs.record(startup)
    logs.record(startup)
    expect(logs.snapshot().entries.map((entry) => entry.id)).toEqual([2, 3])
    expect(logs.snapshot().dropped).toBe(1)
    expect(original.entries).toHaveLength(1)
    const current = logs.snapshot()
    current.entries[0].fields.resourceId = 'env-changed'
    expect(logs.snapshot().entries[0].fields).toEqual({})
    const cleared = logs.clear()
    expect(cleared.entries).toEqual([])
    expect(cleared.dropped).toBe(0)
    expect(cleared.sessionStartedAt).toBe(original.sessionStartedAt)
    logs.record(startup)
    expect(logs.snapshot().entries[0].id).toBe(4)
  })
  it('rejects invalid caps and drops malformed events without breaking commands', () => {
    for (const limit of [0, -1, 1001, 1.5])
      expect(() => createAppLogService(limit)).toThrow('INVALID_LOG_LIMIT')
    const logs = createAppLogService()
    logs.record({ ...startup, method: 'https://example.test/?password=secret' })
    logs.record({ ...startup, fields: { resourceId: '/Users/private/path' } })
    expect(logs.snapshot().entries).toEqual([])
  })
  it('logs durations and approved identifiers without request or result payloads', async () => {
    const logs = createAppLogService()
    const input = {
      proxyId: 'proxy-test',
      config: { host: 'private.example.test', username: 'private-user' },
      password: 'never-record-password',
    }
    const response = ok({ success: true, ip: '203.0.113.15', password: 'never-record-password' })
    expect(await logs.invoke('proxy:test', input, () => response)).toBe(response)
    const entries = logs.snapshot().entries
    expect(entries.map((entry) => [entry.level, entry.event])).toEqual([
      ['debug', 'command-started'],
      ['info', 'command-succeeded'],
    ])
    expect(entries[1]).toMatchObject({
      source: 'proxy',
      method: 'proxy:test',
      fields: { resourceId: 'proxy-test' },
    })
    expect(entries[1].durationMs).toBeGreaterThanOrEqual(0)
    for (const secret of [
      'private.example.test',
      'private-user',
      'never-record-password',
      '203.0.113.15',
    ])
      expect(JSON.stringify(entries)).not.toContain(secret)
  })
  it('keeps query polling out of logs and does not change query results', async () => {
    const logs = createAppLogService()
    const result = ok([])
    for (const method of [
      'logs:list',
      'logs:clear',
      'activity:list',
      'operation:list',
      'environment:list',
      'update:state',
      'kernel:catalog',
    ]) {
      expect(await logs.invoke(method, undefined, () => result)).toBe(result)
    }
    expect(logs.snapshot().entries).toEqual([])
  })
  it.each([
    [fail('NOT_FOUND'), 'error', 'command-failed', 'NOT_FOUND'],
    [
      ok({ success: false, errorCode: 'PROXY_TEST_FAILED' }),
      'error',
      'command-failed',
      'PROXY_TEST_FAILED',
    ],
    [
      ok({ phase: 'error', errorCode: 'UPDATE_NETWORK' }),
      'error',
      'command-failed',
      'UPDATE_NETWORK',
    ],
    [fail('CANCELLED'), 'warn', 'command-cancelled', 'CANCELLED'],
    [ok({ phase: 'cancelled' }), 'warn', 'command-cancelled', undefined],
  ])('records the actual outcome for %j', async (response, level, event, errorCode) => {
    const logs = createAppLogService()
    await logs.invoke('update:download', undefined, () => response)
    expect(logs.snapshot().entries.at(-1)).toMatchObject({ level, event, errorCode })
  })
  it('does not expose raw errors, unexpected codes or arbitrary identifiers', async () => {
    const logs = createAppLogService()
    const response = await logs.invoke(
      'environment:start',
      'https://secret-user:secret-password@example.test',
      () => {
        throw new Error('secret stack https://secret-user:secret-password@example.test')
      },
    )
    expect(response).toEqual(fail('COMMAND_FAILED'))
    await logs.invoke('proxy:save', {}, () => fail('secret-password'))
    expect(logs.snapshot().entries.at(-1)?.errorCode).toBe('COMMAND_FAILED')
    expect(JSON.stringify(logs.snapshot())).not.toContain('secret')
  })
  it('validates log IPC arguments before reading or clearing the session', () => {
    const logs = createAppLogService()
    logs.record(startup)
    const handlers = createAppLogHandlers(logs, vi.fn())
    expect(handlers['logs:list']('/private/log/file')).toEqual(fail('INVALID_INPUT'))
    expect(handlers['logs:clear']({ all: true })).toEqual(fail('INVALID_INPUT'))
    const result = handlers['logs:list'](undefined)
    expect(result.ok).toBe(true)
    if (result.ok) expect(appLogSnapshotSchema.parse(result.data).entries).toHaveLength(1)
    expect(handlers['logs:clear'](undefined)).toEqual(ok(logs.snapshot()))
    expect(logs.snapshot().entries).toEqual([])
  })
  it('copies only a retained validated entry and rejects arbitrary clipboard payloads', () => {
    const logs = createAppLogService(1)
    logs.record(startup)
    const writeClipboard = vi.fn()
    const handlers = createAppLogHandlers(logs, writeClipboard)
    expect(handlers['logs:copy']({ text: 'untrusted text' })).toEqual(fail('INVALID_INPUT'))
    expect(handlers['logs:copy'](-1)).toEqual(fail('INVALID_INPUT'))
    expect(handlers['logs:copy'](2)).toEqual(fail('NOT_FOUND'))
    expect(writeClipboard).not.toHaveBeenCalled()
    expect(handlers['logs:copy'](1)).toEqual(ok(true))
    expect(JSON.parse(writeClipboard.mock.calls[0][0])).toEqual(logs.snapshot().entries[0])
    logs.record(startup)
    expect(handlers['logs:copy'](1)).toEqual(fail('NOT_FOUND'))
    expect(writeClipboard).toHaveBeenCalledOnce()
    writeClipboard.mockImplementation(() => {
      throw new Error('clipboard unavailable')
    })
    expect(handlers['logs:copy'](2)).toEqual(fail('COMMAND_FAILED'))
  })
  it('rejects extra sensitive fields at the contract boundary', () => {
    const logs = createAppLogService()
    logs.record(startup)
    expect(
      appLogEntrySchema.safeParse({ ...logs.snapshot().entries[0], fields: { password: 'secret' } })
        .success,
    ).toBe(false)
    expect(
      appLogEntrySchema.safeParse({ ...logs.snapshot().entries[0], rawError: 'secret' }).success,
    ).toBe(false)
  })
})
