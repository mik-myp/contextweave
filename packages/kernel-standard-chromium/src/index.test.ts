import { describe, expect, it } from 'vitest'
import { StandardChromiumAdapter, createStandardChromiumManifest, discoverStandardChromiumExecutable } from './index'

describe('standard Chromium adapter', () => {
  it('creates a local manifest and applies a user agent', () => {
    const adapter = new StandardChromiumAdapter(createStandardChromiumManifest('darwin', 'arm64'))
    const result = adapter.buildLaunchPlan({
      environmentId: 'env-test',
      userDataDir: '/tmp/contextweave',
      controlPort: 9444,
      executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
      proxyArgs: [],
      commonArgs: ['--lang=zh-CN'],
      kernelArgs: ['--disable-features=Translate'],
    }, { userAgent: 'ContextWeaveTest/1.0' })

    expect(adapter.getManifest().version).toBe('local')
    expect(result.args).toContain('--user-agent=ContextWeaveTest/1.0')
    expect(result.args).toContain('--lang=zh-CN')
    expect(result.args).toContain('--disable-features=Translate')
  })

  it('returns no candidates when the supplied platform environment has no paths', () => {
    expect(discoverStandardChromiumExecutable('win32', {})).toEqual([])
  })
})
