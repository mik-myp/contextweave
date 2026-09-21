import { describe, expect, it } from 'vitest'
import { FingerprintChromiumAdapter, createFingerprintChromiumManifest } from './index'

describe('fingerprint Chromium adapter', () => {
  it('declares the platform-specific manifest and flags', () => {
    const adapter = new FingerprintChromiumAdapter(createFingerprintChromiumManifest('win32', 'x64'))
    const result = adapter.buildLaunchPlan({
      environmentId: 'env-test',
      userDataDir: 'C:\\data',
      controlPort: 9333,
      executablePath: 'fingerprint.exe',
      proxyArgs: [],
      commonArgs: [],
      kernelArgs: [],
    }, {
      platform: 'macOS',
      canvasMode: 'noise',
      audioMode: 'off',
      webglMode: 'default',
    })

    expect(adapter.getManifest().id).toBe('fingerprint-chromium')
    expect(result.args).toContain('--cw-fingerprint-platform=macOS')
    expect(result.args).toContain('--cw-canvas-mode=noise')
    expect(result.args).toContain('--cw-audio-mode=off')
    expect(result.args).toContain('--cw-webgl-mode=default')
  })

  it('reports invalid kernel-specific settings', () => {
    const adapter = new FingerprintChromiumAdapter(createFingerprintChromiumManifest('darwin', 'arm64'))
    expect(adapter.validateConfig({ canvasMode: 'invalid' }).ok).toBe(false)
  })
})
