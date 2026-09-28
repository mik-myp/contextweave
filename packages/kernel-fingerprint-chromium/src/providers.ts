import type { KernelManifest, TargetArchitecture, TargetPlatform } from '@contextweave/contracts'
import { fingerprintChromiumLicense } from './provider-license'

/** These records describe audited evidence, not a claim of formal platform support. */
export interface FingerprintProviderRelease {
  readonly providerId: string
  readonly version: string
  readonly platform: TargetPlatform
  readonly arch: TargetArchitecture
  readonly releaseTag: string
  readonly sourceCommit: string
  readonly sourceStatus: 'patches-published' | 'patches-unavailable'
  readonly admission: 'legacy-candidate' | 'audit-only'
  readonly package: Readonly<
    Required<Pick<NonNullable<KernelManifest['package']>, 'url' | 'sha256' | 'sizeBytes'>>
  >
}

const upstreamSource = 'https://github.com/adryfish/fingerprint-chromium'
const intelSource = 'https://github.com/pocchian/fingerprint-chromium-macos-x86_64'
export const fingerprintProviders = [
  {
    id: 'fingerprint-chromium',
    label: 'Fingerprint Chromium (adryfish)',
    source: upstreamSource,
    license: 'BSD-3-Clause',
    licenseText: fingerprintChromiumLicense,
    admission: 'legacy-candidate',
  },
  {
    id: 'fingerprint-chromium-pocchian-intel',
    label: 'Fingerprint Chromium (pocchian Intel)',
    source: intelSource,
    license: 'BSD-3-Clause',
    // A source-review candidate must not borrow the legacy provider's notice or execute.
    licenseText: undefined,
    admission: 'audit-only',
  },
] as const

export const fingerprintProviderReleases: readonly FingerprintProviderRelease[] = [
  {
    providerId: 'fingerprint-chromium',
    version: '148.0.7778.215',
    platform: 'win32',
    arch: 'x64',
    releaseTag: '148.0.7778.215',
    sourceCommit: '3f61b0dfa665e883da8824b1450601fc529dd006',
    sourceStatus: 'patches-unavailable',
    admission: 'legacy-candidate',
    package: {
      url: `${upstreamSource}/releases/download/148.0.7778.215/ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip`,
      sha256: '9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579',
      sizeBytes: 189767686,
    },
  },
  {
    providerId: 'fingerprint-chromium',
    version: '148.0.7778.215',
    platform: 'darwin',
    arch: 'arm64',
    releaseTag: '148.0.7778.215',
    sourceCommit: '3f61b0dfa665e883da8824b1450601fc529dd006',
    sourceStatus: 'patches-unavailable',
    admission: 'legacy-candidate',
    package: {
      url: `${upstreamSource}/releases/download/148.0.7778.215/ungoogled-chromium_148.0.7778.215-1.1_macos.dmg`,
      sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679',
      sizeBytes: 140187500,
    },
  },
  {
    providerId: 'fingerprint-chromium-pocchian-intel',
    version: '152.0.7977.82',
    platform: 'darwin',
    arch: 'x64',
    releaseTag: 'v152.0.7977.82',
    sourceCommit: 'c1ab3abd0d29ad5871a0df1cdf93b666abe5f7a8',
    sourceStatus: 'patches-published',
    admission: 'audit-only',
    package: {
      url: `${intelSource}/releases/download/v152.0.7977.82/ungoogled-chromium_152.0.7977.82-1.1_x86_64-macos-adhoc-tellsfix.dmg`,
      sha256: '95177259f4f86ef09c5a8690230fce5c3de2c8f140f3128c94df06383ebf55e7',
      sizeBytes: 147123561,
    },
  },
]

export function fingerprintProvider(id: string) {
  return fingerprintProviders.find((provider) => provider.id === id)
}

export function fingerprintProviderRelease(
  id: string,
  platform: TargetPlatform,
  arch: TargetArchitecture,
  version: string,
) {
  return fingerprintProviderReleases.find(
    (release) =>
      release.providerId === id &&
      release.platform === platform &&
      release.arch === arch &&
      release.version === version,
  )
}

export function fingerprintKernelId(version: string, providerId = 'fingerprint-chromium'): string {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('VERSION_INVALID')
  if (!fingerprintProvider(providerId)) throw new Error('PROVIDER_UNVERIFIED')
  return `${providerId}-${version.replaceAll('.', '-')}`
}

export function fingerprintKernelProviderId(id: string): string | undefined {
  if (id === 'fingerprint-chromium') return 'fingerprint-chromium'
  return fingerprintProviders.find((provider) => {
    const prefix = `${provider.id}-`
    if (!id.startsWith(prefix)) return false
    const suffix = id.slice(prefix.length)
    // Custom mirrors remain the existing explicit legacy opt-in, not a route to new providers.
    return (
      /^\d+-\d+-\d+-\d+$/.test(suffix) ||
      (provider.id === 'fingerprint-chromium' &&
        /^custom-\d+-\d+-\d+-\d+-[0-9a-f]{12}$/.test(suffix))
    )
  })?.id
}

/** Persisted manifests/IPC metadata cannot grant another publisher the legacy identity. */
export function fingerprintManifestProvider(manifest: KernelManifest) {
  const identity = fingerprintKernelProviderId(manifest.id)
  if (!identity || (manifest.providerId !== undefined && manifest.providerId !== identity))
    return undefined
  // Pre-v0.3 manifests have no provider field. Only the unchanged legacy namespace is implicit.
  if (manifest.providerId === undefined && identity !== 'fingerprint-chromium') return undefined
  const provider = fingerprintProvider(identity)
  if (!provider) return undefined
  if (manifest.sourceType === 'custom') {
    return identity === 'fingerprint-chromium' && manifest.id.startsWith(`${identity}-custom-`)
      ? provider
      : undefined
  }
  return manifest.source === provider.source ? provider : undefined
}

// For an explicitly trusted custom mirror this remains the adapter upstream notice,
// not an attestation that the mirror built an identical binary or has no other notices.
export function fingerprintProviderNotice(manifest: KernelManifest): string {
  const provider = fingerprintManifestProvider(manifest)
  if (!provider || provider.admission !== 'legacy-candidate' || !provider.licenseText)
    throw new Error('PROVIDER_UNVERIFIED')
  return provider.licenseText
}
