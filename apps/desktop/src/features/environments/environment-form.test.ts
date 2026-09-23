import { describe, expect, it } from 'vitest'
import { environmentDetailsSchema } from '@contextweave/contracts'
import {
  createEnvironmentFormSchema,
  environmentFormDefaults,
  toCreateEnvironmentInput,
  toUpdateEnvironmentInput,
} from './environment-form'
import { workspaceMessages } from '../../i18n/locales/zh-CN-workspace'
import type { I18nContextValue } from '../../i18n'
const t: I18nContextValue['t'] = (key) =>
  key in workspaceMessages ? Reflect.get(workspaceMessages, key) : key
const values = { ...environmentFormDefaults(), name: ' Test ', kernelId: 'standard-chromium' }

describe('environment configuration form', () => {
  it('starts with system settings and submits explicit direct-connection clearing', () => {
    expect(values.language).toBe('system')
    expect(values.timezone).toBe('system')
    const created = toCreateEnvironmentInput({ ...values, proxyId: 'previous-proxy' })
    expect(created.name).toBe('Test')
    expect(created.proxyId).toBeUndefined()
    expect(
      toUpdateEnvironmentInput('env-test', { ...values, proxyId: 'previous-proxy' }).proxyId,
    ).toBeNull()
  })
  it('round trips all editable values without exposing a different kernel binding', () => {
    const detail = environmentDetailsSchema.parse({
      id: 'env-test',
      name: 'Test',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      status: 'stopped',
      proxyId: 'proxy-a',
      platform: 'darwin',
      arch: 'arm64',
      updatedAt: new Date().toISOString(),
      browserSettings: {
        language: 'en-GB',
        timezone: 'Europe/London',
        window: { width: 1280, height: 800 },
      },
    })
    const edited = environmentFormDefaults(detail)
    expect(edited.connection).toBe('proxy')
    const input = toUpdateEnvironmentInput(detail.id, edited)
    expect(input.browserSettings).toEqual(detail.browserSettings)
    expect(input.proxyId).toBe('proxy-a')
    expect(input).not.toHaveProperty('kernelId')
  })
  it('reports errors on the fields that need correction', () => {
    const result = createEnvironmentFormSchema(t).safeParse({
      ...values,
      name: ' ',
      connection: 'proxy',
      width: NaN,
      timezone: 'Mars/Olympus',
      language: 'not language',
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(new Set(result.error.issues.map((issue) => issue.path[0]))).toEqual(
        new Set(['name', 'width', 'timezone', 'language']),
      )
    const missingProxy = createEnvironmentFormSchema(t).safeParse({
      ...values,
      connection: 'proxy',
    })
    expect(missingProxy.success).toBe(false)
    if (!missingProxy.success) expect(missingProxy.error.issues[0].path).toEqual(['proxyId'])
  })
})
