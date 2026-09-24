import { describe, expect, it } from 'vitest'
import { browserSettingsSchema, ipLocaleRequestSchema, ipLocaleResultSchema } from './index'
const requestId = 'f48819db-079f-47ab-af0c-425a88b3fbf0'
describe('IP locale contracts', () => {
  it('preserves concrete/system modes and allows independent automatic choices', () => {
    for (const language of ['system', 'auto', 'en-US']) for (const timezone of ['system', 'auto', 'Europe/London'])
      expect(browserSettingsSchema.safeParse({ language, timezone, window: { width: 1440, height: 900 } }).success).toBe(true)
  })
  it('only accepts an explicit route and saved proxy identity', () => {
    expect(ipLocaleRequestSchema.safeParse({ requestId, connection: 'direct' }).success).toBe(true)
    expect(ipLocaleRequestSchema.safeParse({ requestId, connection: 'proxy', proxyId: 'p1' }).success).toBe(true)
    for (const input of [{ requestId, connection: 'proxy' }, { requestId, connection: 'direct', proxyId: 'p1' }, { requestId, connection: 'proxy', proxyId: 'p1', url: 'https://example.com' }, { requestId: '../path', connection: 'direct' }])
      expect(ipLocaleRequestSchema.safeParse(input).success).toBe(false)
  })
  it('rejects unresolved or malformed responses across the IPC boundary', () => {
    const result = { ip: '2001:db8::1', countryCode: 'GB', language: 'en-GB', timezone: 'Europe/London', provider: 'ipwho.is', connection: 'proxy', checkedAt: new Date().toISOString() }
    expect(ipLocaleResultSchema.safeParse(result).success).toBe(true)
    for (const bad of [{ ip: 'bad' }, { language: 'auto' }, { timezone: 'system' }, { timezone: 'auto' }, { password: 'secret' }])
      expect(ipLocaleResultSchema.safeParse({ ...result, ...bad }).success).toBe(false)
  })
})
