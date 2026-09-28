import { describe, expect, it } from 'vitest'
import { kernelManifestSchema, type KernelManifest } from '@contextweave/contracts'
import {
  createFingerprintChromiumManifest,
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
  it('does not promote an audited Intel package to an executable or share legacy notices', () => {
    const release = fingerprintProviderRelease(intel, 'darwin', 'x64', '152.0.7977.82')!
    expect(release).toMatchObject({ admission: 'audit-only', sourceStatus: 'patches-published' })
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
    expect(() => fingerprintProviderNotice(manifest)).toThrow('PROVIDER_UNVERIFIED')
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
