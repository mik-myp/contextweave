import { describe, expect, it } from 'vitest'
import { kernelManifestSchema, type KernelManifest } from '@contextweave/contracts'
import {
  createFingerprintChromiumManifest,
  fingerprintArchiveFormat,
  fingerprintKernelId,
  fingerprintKernelProviderId,
  fingerprintManifestProvider,
  fingerprintProvider,
  fingerprintProviderNotice,
  fingerprintProviderRelease,
  fingerprintProviderReleases,
  isFingerprintKernel,
} from './index'

const intel = 'fingerprint-chromium-pocchian-intel'
function legacy(): KernelManifest {
  return createFingerprintChromiumManifest('win32', 'x64')
}

describe('platform-specific provider identities', () => {
  it('preserves the original IDs and separates an identical version from another publisher', () => {
    expect(fingerprintKernelId('148.0.7778.215')).toBe('fingerprint-chromium-148-0-7778-215')
    const id = fingerprintKernelId('152.0.7977.82', intel)
    expect(id).not.toBe(fingerprintKernelId('152.0.7977.82'))
    expect(fingerprintKernelProviderId(id)).toBe(intel)
    expect(isFingerprintKernel(id)).toBe(true)
    expect(fingerprintKernelProviderId('fingerprint-chromium')).toBe('fingerprint-chromium')
    expect(
      fingerprintKernelProviderId(`fingerprint-chromium-custom-148-0-7778-215-${'a'.repeat(12)}`),
    ).toBe('fingerprint-chromium')
    expect(
      fingerprintKernelProviderId(`${intel}-custom-152-0-7977-82-${'a'.repeat(12)}`),
    ).toBeUndefined()
    expect(() => fingerprintKernelId('152.0.7977.82', 'unknown')).toThrow('PROVIDER_UNVERIFIED')
    expect(() => fingerprintKernelId('../152')).toThrow('VERSION_INVALID')
  })
  it('accepts old saved manifests only in the unchanged legacy namespace', () => {
    const old = legacy()
    delete old.providerId
    expect(kernelManifestSchema.parse(old).providerId).toBeUndefined()
    expect(fingerprintManifestProvider(old)?.id).toBe('fingerprint-chromium')
    expect(fingerprintProviderNotice(old)).toBe(fingerprintProviderNotice(legacy()))
    const community = {
      ...old,
      id: fingerprintKernelId('152.0.7977.82', intel),
      source: fingerprintProvider(intel)!.source,
    }
    expect(fingerprintManifestProvider(community)).toBeUndefined()
    expect(fingerprintManifestProvider({ ...community, providerId: intel })?.id).toBe(intel)
  })
  it.each([
    { providerId: intel },
    { providerId: 'unknown' },
    { source: 'https://github.com/other/fingerprint-chromium' },
    { source: 'https://github.com/adryfish/fingerprint-chromium.evil' },
    { source: undefined },
  ])('does not let metadata disguise another publisher: %j', (change) => {
    const manifest = { ...legacy(), ...change }
    expect(fingerprintManifestProvider(manifest)).toBeUndefined()
    expect(() => fingerprintProviderNotice(manifest)).toThrow('PROVIDER_UNVERIFIED')
  })
  it.each(['../other', 'Other', 'provider/name', ''])(
    'rejects malformed provider identifiers at the contract boundary: %s',
    (providerId) => {
      expect(kernelManifestSchema.safeParse({ ...legacy(), providerId }).success).toBe(false)
    },
  )
  it('keeps explicit custom mirrors distinct without authorizing new provider mirrors', () => {
    const manifest = {
      ...legacy(),
      sourceType: 'custom' as const,
      id: `fingerprint-chromium-custom-148-0-7778-215-${'b'.repeat(12)}`,
      source: 'https://mirror.example.test/archive.zip',
    }
    expect(fingerprintManifestProvider(manifest)?.id).toBe('fingerprint-chromium')
    expect(fingerprintManifestProvider({ ...manifest, id: 'fingerprint-chromium' })).toBeUndefined()
    expect(fingerprintManifestProvider({ ...manifest, providerId: intel })).toBeUndefined()
  })
  it('binds source-reviewed Intel bytes to its own notice without offering them on other platforms', () => {
    const release = fingerprintProviderRelease(intel, 'darwin', 'x64', '152.0.7977.82')!
    expect(release).toMatchObject({
      admission: 'source-reviewed',
      sourceStatus: 'patches-published',
    })
    expect(fingerprintProviderRelease(intel, 'darwin', 'arm64', '152.0.7977.82')).toBeUndefined()
    expect(fingerprintProviderRelease(intel, 'win32', 'x64', '152.0.7977.82')).toBeUndefined()
    const manifest = {
      ...createFingerprintChromiumManifest('darwin', 'x64'),
      id: fingerprintKernelId(release.version, intel),
      providerId: intel,
      version: release.version,
      package: { ...release.package },
      source: fingerprintProvider(intel)!.source,
    }
    expect(fingerprintProviderNotice(manifest)).toContain('Copyright (c) 2026 pocchian')
    expect(fingerprintProviderNotice(manifest)).not.toBe(fingerprintProviderNotice(legacy()))
    expect(createFingerprintChromiumManifest('darwin', 'x64').package).toBeUndefined()
  })
  it('keeps existing downloads pinned and returns independent manifest package objects', () => {
    const expected = fingerprintProviderRelease(
      'fingerprint-chromium',
      'win32',
      'x64',
      '148.0.7778.215',
    )!
    const manifest = legacy()
    expect(manifest.package).toEqual(expected.package)
    manifest.package!.sha256 = 'f'.repeat(64)
    expect(legacy().package).toEqual(expected.package)
    expect(expected.sourceStatus).toBe('patches-unavailable')
    const keys = fingerprintProviderReleases.map((release) =>
      [release.providerId, release.version, release.platform, release.arch].join(':'),
    )
    expect(new Set(keys).size).toBe(keys.length)
    for (const release of fingerprintProviderReleases) {
      expect(release.sourceCommit).toMatch(/^[a-f0-9]{40}$/)
      expect(release.package.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(new URL(release.package.url).pathname).toContain(
        `/releases/download/${release.releaseTag}/`,
      )
    }
  })
})

describe('fixed reviewed archive identity and notices', () => {
  const providerId = 'fingerprint-chromium-apostate'
  function candidate(platform: 'darwin' | 'win32' = 'darwin'): KernelManifest {
    const arch = platform === 'darwin' ? 'arm64' : 'x64'
    const release = fingerprintProviderRelease(providerId, platform, arch, '152.0.7977.83')!
    return {
      ...createFingerprintChromiumManifest(platform, arch),
      id: fingerprintKernelId(release.version, providerId),
      providerId,
      version: release.version,
      source: fingerprintProvider(providerId)!.source,
      package: { ...release.package },
      dataDirCompatibility: [release.version],
    }
  }
  it.each(['darwin', 'win32'] as const)(
    'identifies the fixed %s ZIP and its independently retained notice',
    (platform) => {
      const manifest = candidate(platform)
      expect(fingerprintArchiveFormat(manifest)).toBe('zip')
      expect(fingerprintProvider(providerId)?.admission).toBe('source-reviewed')
      const release = fingerprintProviderRelease(
        providerId,
        platform,
        manifest.arch,
        manifest.version,
      )!
      expect(release).toMatchObject({ releaseTag: 'v0.4.3', admission: 'source-reviewed' })
      expect(release.version).not.toBe(release.releaseTag)
      expect(fingerprintProviderNotice(manifest)).toContain('GNU GENERAL PUBLIC LICENSE')
    },
  )
  it.each([
    { providerId: undefined },
    { providerId: 'fingerprint-chromium' },
    { source: 'https://github.com/other/apostate' },
    { sourceType: 'custom' as const },
    { version: '152.0.7977.82' },
    { id: 'fingerprint-chromium-apostate-152-0-7977-82' },
    { arch: 'x64' as const },
    { platform: 'linux' as const },
    { package: undefined },
  ])('rejects mismatched identity/platform/version/package: %j', (change) => {
    expect(fingerprintArchiveFormat({ ...candidate(), ...change })).toBeUndefined()
  })
  it.each([
    { url: 'https://mirror.example.test/archive.zip' },
    { sha256: 'a'.repeat(64) },
    { sizeBytes: 1 },
    { sha256: undefined },
    { sizeBytes: undefined },
  ])('does not derive a package type from unpinned bytes: %j', (change) => {
    const manifest = candidate()
    manifest.package = { ...manifest.package, ...change }
    expect(fingerprintArchiveFormat(manifest)).toBeUndefined()
    expect(() => fingerprintProviderNotice(manifest)).toThrow('PROVIDER_UNVERIFIED')
  })
  it('preserves legacy package layouts and accepts the same SHA-256 in upper case', () => {
    expect(fingerprintArchiveFormat(legacy())).toBe('zip')
    const mac = createFingerprintChromiumManifest('darwin', 'arm64')
    delete mac.providerId
    expect(fingerprintArchiveFormat(mac)).toBe('dmg')
    const manifest = candidate()
    manifest.package!.sha256 = manifest.package!.sha256!.toUpperCase()
    expect(fingerprintArchiveFormat(manifest)).toBe('zip')
    expect(
      fingerprintProviderRelease(providerId, 'darwin', 'x64', manifest.version),
    ).toBeUndefined()
  })
})
