import { describe, expect, it } from 'vitest'
import { appInfoSchema, appPathsSchema, appPathKeySchema, customKernelSourceSchema, externalUrlSchema } from './index'

describe('application IPC contracts', () => {
  it('validates platform-aware app information without accepting private extra fields', () => {
    const info = {
      name: 'ContextWeave',
      version: '0.1.6',
      platform: 'win32',
      arch: 'x64',
      secureStorageAvailable: true,
    }
    expect(appInfoSchema.safeParse(info).success).toBe(true)
    expect(appInfoSchema.safeParse({ ...info, arch: 'unsupported' }).success).toBe(false)
    expect(appInfoSchema.safeParse({ ...info, credential: 'private' }).success).toBe(false)
    expect(appPathsSchema.safeParse({ userData: '/fixture' }).success).toBe(false)
  })
  it.each([
    'not a URL',
    'file:///private',
    'javascript:alert(1)',
    'https://u:p@example.test/',
    'https://example.test/' + 'a'.repeat(8192),
  ])('rejects external URL %s with a validation result rather than throwing', (url) => {
    expect(externalUrlSchema.safeParse(url).success).toBe(false)
  })
  it('accepts bounded HTTP(S) URLs with normal query and hash values', () => {
    expect(externalUrlSchema.safeParse('https://example.test/help?q=hello#page').success).toBe(true)
    expect(externalUrlSchema.safeParse('http://127.0.0.1:8080/').success).toBe(true)
  })
  it('also safely rejects malformed custom-kernel URLs', () => {
    expect(
      customKernelSourceSchema.safeParse({ providerId: 'fingerprint-chromium', url: 'not a URL' })
        .success,
    ).toBe(false)
  })
})

it('limits copyable data addresses to the declared application path keys', () => {
  expect(appPathKeySchema.options).toEqual(['userData', 'dataRoot', 'environmentRoot', 'kernelRoot', 'logRoot'])
  for (const key of appPathKeySchema.options) expect(appPathKeySchema.safeParse(key).success).toBe(true)
  for (const input of ['../private', 'clipboard', '__proto__', '', null, { key: 'dataRoot' }]) {
    expect(appPathKeySchema.safeParse(input).success).toBe(false)
  }
})
