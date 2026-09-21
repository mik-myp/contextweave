import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildChromiumArgs, installKernelPackage, KernelRegistry, type BrowserKernelAdapter } from './index'

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
    expect(buildChromiumArgs({
      environmentId: 'env-test',
      userDataDir: 'C:\\data',
      controlPort: 9222,
      executablePath: 'chrome.exe',
      proxyArgs: ['--proxy-server=http://127.0.0.1:8080'],
      commonArgs: ['--lang=zh-CN'],
      kernelArgs: ['--kernel-test=true'],
    })).toEqual([
      '--user-data-dir=C:\\data',
      '--remote-debugging-port=9222',
      '--no-first-run',
      '--no-default-browser-check',
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

  it('verifies a package before atomically installing the executable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'contextweave-kernel-'))
    try {
      const bytes = new TextEncoder().encode('verified-kernel')
      const result = await installKernelPackage({
        ...adapter.getManifest(),
        package: {
          url: 'https://downloads.example.test/test-kernel.bin',
          sha256: '01944a0fa97916354003abca7d37bccff6459a8d8947b6343b8c98fa22a8fc31',
          sizeBytes: bytes.byteLength,
        },
      }, directory, {
        download: async () => bytes,
      })

      expect(result.executablePath).toContain('test-kernel')
      expect(result.sizeBytes).toBe(bytes.byteLength)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a package when the declared hash does not match', async () => {
    const bytes = new TextEncoder().encode('untrusted-kernel')
    await expect(installKernelPackage({
      ...adapter.getManifest(),
      package: {
        url: 'https://downloads.example.test/test-kernel.bin',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      },
    }, 'C:\\contextweave-test', {
      download: async () => bytes,
    })).rejects.toThrow('SHA-256 mismatch')
  })
})
