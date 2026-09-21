import { describe, expect, it } from 'vitest'
import {
  commonEnvironmentConfigSchema,
  createEnvironmentInputSchema,
  environmentConfigSchema,
  proxyConfigSchema,
} from './index'

describe('contracts', () => {
  it('fills safe defaults for a common environment configuration', () => {
    expect(commonEnvironmentConfigSchema.parse({})).toEqual({
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      window: { width: 1440, height: 900 },
      hardwareConcurrency: 8,
      webRtcPolicy: 'proxy',
      dnsPolicy: 'proxy',
    })
  })

  it('rejects malformed proxy ports', () => {
    expect(proxyConfigSchema.safeParse({
      type: 'http',
      host: '127.0.0.1',
      port: 70000,
    }).success).toBe(false)
  })

  it('normalizes a complete environment input into a versioned config', () => {
    const input = createEnvironmentInputSchema.parse({
      name: '美国店铺',
      kernelId: 'standard-chromium',
      commonConfig: { language: 'en-US', timezone: 'America/Los_Angeles' },
    })
    const config = environmentConfigSchema.parse({
      environmentId: 'env-test',
      name: input.name,
      kernelId: input.kernelId,
      kernelVersion: 'local',
      commonConfig: input.commonConfig,
      kernelConfig: input.kernelConfig,
    })

    expect(config.configVersion).toBe(1)
    expect(config.commonConfig.window.width).toBe(1440)
    expect(config.kernelConfig).toEqual({})
  })
})
