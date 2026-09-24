import { describe, expect, it } from 'vitest'
import {
  buildChromiumArgs,
  KernelRegistry,
  type BrowserKernelAdapter,
} from './index'

const adapter: BrowserKernelAdapter = {
  getManifest: () => ({
    id: 'test-kernel',
    family: 'chromium',
    version: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    executable: 'chrome.exe',
    controlProtocol: 'cdp',
    capabilities: {
      cdp: true,
      screenshot: true,
      fileUpload: false,
      elementScreenshot: false,
      userAgent: true,
      timezone: true,
      proxy: true,
      webRtcPolicy: true,
    },
    configSchema: 'test-v1',
    dataDirCompatibility: ['test'],
    license: 'test',
  }),
  validateConfig: () => ({ ok: true }),
  buildLaunchPlan: () => ({
    executablePath: 'chrome.exe',
    args: [],
    userDataDir: 'data',
    controlPort: 9222,
  }),
  getCapabilities: () => adapter.getManifest().capabilities,
}

describe('kernel core', () => {
  it('builds deterministic Chromium launch arguments', () => {
    expect(
      buildChromiumArgs({
        environmentId: 'env-test',
        userDataDir: 'C:\\data',
        controlPort: 9222,
        executablePath: 'chrome.exe',
        proxyArgs: ['--proxy-server=http://127.0.0.1:8080'],
        commonArgs: ['--lang=zh-CN'],
        kernelArgs: ['--kernel-test=true'],
      }),
    ).toEqual([
      '--user-data-dir=C:\\data',
      '--remote-debugging-port=9222',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--restore-last-session',
      '--disable-background-mode',
      '--disable-features=Translate',
      '--proxy-server=http://127.0.0.1:8080',
      '--lang=zh-CN',
      '--kernel-test=true',
    ])
  })

  it('rejects duplicate adapter ids and unknown lookups', () => {
    const registry = new KernelRegistry()
    registry.register(adapter)
    expect(() => registry.register(adapter)).toThrow('already registered')
    expect(registry.get('test-kernel')).toBe(adapter)
    expect(() => registry.get('missing')).toThrow('not found')
  })

})
