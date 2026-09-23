import { describe, expect, it } from 'vitest'
import { FingerprintChromiumAdapter, createFingerprintChromiumManifest } from './index'

describe('fingerprint Chromium adapter', () => {
  it('keeps the unconfigured provider unavailable without emitting invented flags', () => {
    const adapter = new FingerprintChromiumAdapter(
      createFingerprintChromiumManifest('win32', 'x64'),
    )
    expect(() =>
      adapter.buildLaunchPlan(
        {
          environmentId: 'env-test',
          userDataDir: 'C:\\data',
          controlPort: 9333,
          executablePath: 'fingerprint.exe',
          proxyArgs: [],
          commonArgs: [],
          kernelArgs: [],
        },
        {
          platform: 'macOS',
          canvasMode: 'noise',
          audioMode: 'off',
          webglMode: 'default',
        },
      ),
    ).toThrow('PROVIDER_UNVERIFIED')

    expect(adapter.getManifest().id).toBe('fingerprint-chromium')
    expect(Object.values(adapter.getCapabilities()).every((value) => !value)).toBe(true)
  })

  it('reports invalid kernel-specific settings', () => {
    const adapter = new FingerprintChromiumAdapter(
      createFingerprintChromiumManifest('darwin', 'arm64'),
    )
    expect(adapter.validateConfig({ canvasMode: 'invalid' }).ok).toBe(false)
  })
})
