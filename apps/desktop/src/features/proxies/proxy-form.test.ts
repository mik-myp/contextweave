import { describe, expect, it } from 'vitest'
import { saveProxyInputSchema, activitySummarySchema } from '@contextweave/contracts'
import { zhCNMessages } from '../../i18n/locales/zh-CN'
import { proxyFormSchema, toSaveProxyInput } from './proxy-form'
const schema = proxyFormSchema((key) => zhCNMessages[key])
const values = {
  type: 'http' as const,
  host: 'proxy.example.com',
  port: '8080',
  username: '',
  password: '',
  clearPassword: false,
}
describe('proxy editor', () => {
  it('rejects URI fragments, embedded ports, credentials and invalid port values', () => {
    for (const host of [
      'http://proxy.test',
      'user:pass@proxy.test',
      'proxy.test/path',
      'proxy.test:8080',
      '--flag',
      'a b',
      '::1',
      '[:::1]',
      '[1234]',
      'a..b',
      '-proxy.test',
      'host:80',
    ])
      expect(schema.safeParse({ ...values, host }).success, host).toBe(false)
    for (const port of ['0', '65536', '8.5', '1e3', ''])
      expect(schema.safeParse({ ...values, port }).success, port).toBe(false)
    for (const host of ['127.0.0.1', 'localhost', '[::1]', 'proxy.example.com'])
      expect(schema.safeParse({ ...values, host }).success, host).toBe(true)
  })
  it('preserves omitted passwords and distinguishes explicit clearing', () => {
    expect(toSaveProxyInput(values, 'proxy-1').password).toBeUndefined()
    expect(
      toSaveProxyInput({ ...values, clearPassword: true, password: 'stale' }, 'proxy-1'),
    ).toMatchObject({ clearPassword: true, password: undefined })
    expect(saveProxyInputSchema.safeParse(toSaveProxyInput(values)).success).toBe(true)
    expect(schema.safeParse({ ...values, password: 'secret' }).success).toBe(false)
    expect(
      saveProxyInputSchema.safeParse({
        config: { type: 'socks5', host: 'localhost', port: 1080, username: 'name' },
        password: 'secret',
      }).success,
    ).toBe(false)
  })
  it('never includes process identifiers or control ports in the activity response', () => {
    const result = activitySummarySchema.parse({
      sessionId: 's1',
      environmentId: 'e1',
      pid: 999,
      controlPort: 4444,
      status: 'stopped',
      startedAt: new Date().toISOString(),
      exitReason: null,
    })
    expect(result).not.toHaveProperty('pid')
    expect(result).not.toHaveProperty('controlPort')
  })
})
