import { describe, expect, it } from 'vitest'
import { FingerprintChromiumAdapter, createFingerprintChromiumManifest } from './index'
const input = { environmentId: 'env-test', userDataDir: '/isolated/data', controlPort: 9333, executablePath: 'chromium', proxyArgs: [], commonArgs: ['--timezone=Asia/Shanghai'], kernelArgs: [] }
describe('fingerprint Chromium adapter', () => {
  it('reuses the persisted seed and only emits real upstream parameters', () => {
    const adapter = new FingerprintChromiumAdapter(createFingerprintChromiumManifest('darwin', 'arm64'))
    const config = { seed: 4294967295, platform: 'macos' as const, hardwareConcurrency: 8 }
    expect(adapter.buildLaunchPlan(input, config)).toEqual(adapter.buildLaunchPlan(input, config))
    expect(adapter.buildLaunchPlan(input, config).args).toEqual(expect.arrayContaining([
      '--fingerprint=4294967295', '--fingerprint-platform=macos', '--fingerprint-hardware-concurrency=8', '--timezone=Asia/Shanghai',
    ]))
    expect(adapter.validateConfig({ ...config, seed: 4294967296 }).ok).toBe(false)
    expect(adapter.validateConfig({ ...config, canvasMode: 'noise' }).ok).toBe(false)
  })
  it('requires an existing stable identity and rejects legacy placeholder settings', () => {
    const adapter = new FingerprintChromiumAdapter(createFingerprintChromiumManifest('win32', 'x64'))
    expect(adapter.validateConfig({}).ok).toBe(false)
    expect(adapter.validateConfig({ canvasMode: 'noise' }).ok).toBe(false)
  })
  it('does not offer the arm64 DMG to Intel Macs or an unsupported platform', () => {
    for (const [platform, arch] of [['darwin', 'x64'], ['win32', 'arm64'], ['linux', 'x64']] as const) {
      const adapter = new FingerprintChromiumAdapter(createFingerprintChromiumManifest(platform, arch))
      expect(adapter.getManifest().package).toBeUndefined()
      expect(() => adapter.buildLaunchPlan(input, { seed: 123, platform: 'macos', hardwareConcurrency: 8 })).toThrow('PLATFORM_UNSUPPORTED')
    }
  })
})
