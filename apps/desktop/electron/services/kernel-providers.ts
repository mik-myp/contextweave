import type { KernelManifest, TargetArchitecture, TargetPlatform } from '@contextweave/contracts'
import {
  createFingerprintChromiumManifest,
  fingerprintKernelId,
  fingerprintManifestProvider,
  fingerprintProviders,
  fingerprintArchiveFormat,
  reviewedFingerprintManifests,
} from '@contextweave/kernel-fingerprint-chromium'

// Downloadable provider registrations. Native browser discovery remains separate.
export const kernelProviders = fingerprintProviders.filter(
  (provider) =>
    provider.admission === 'legacy-candidate' || provider.admission === 'source-reviewed',
)
export function requireKernelProvider(id: string) {
  const provider = kernelProviders.find((provider) => provider.id === id)
  if (!provider) throw new Error('PROVIDER_UNVERIFIED')
  return provider
}
export function providerManifest(
  id: string,
  platform: TargetPlatform,
  arch: TargetArchitecture,
): KernelManifest {
  requireKernelProvider(id)
  if (id === 'fingerprint-chromium') return createFingerprintChromiumManifest(platform, arch)
  const manifest = reviewedFingerprintManifests(platform, arch).find(
    (item) => item.providerId === id,
  )
  if (!manifest) throw new Error('PLATFORM_UNSUPPORTED')
  return manifest
}

export function supportsFingerprintVersion(version: string): boolean {
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(version) &&
    [136, 138, 139, 142, 144, 148].includes(Number(version.split('.')[0]))
  )
}

// Adapter compatibility is not a source, signature, or fingerprint verification claim.
export function isCompatibleFingerprintManifest(manifest: KernelManifest): boolean {
  const provider = fingerprintManifestProvider(manifest)
  if (!provider) return false
  if (provider.admission === 'source-reviewed') {
    const pinned = reviewedFingerprintManifests(manifest.platform, manifest.arch).find(
      (item) => item.id === manifest.id,
    )
    return Boolean(
      pinned &&
      fingerprintArchiveFormat(manifest) &&
      manifest.family === pinned.family &&
      manifest.executable === pinned.executable &&
      manifest.controlProtocol === pinned.controlProtocol &&
      manifest.configSchema === pinned.configSchema &&
      manifest.dataDirCompatibility.length === 1 &&
      manifest.dataDirCompatibility[0] === pinned.version,
    )
  }
  if (provider.admission !== 'legacy-candidate') return false
  const base = createFingerprintChromiumManifest(manifest.platform, manifest.arch)
  if (
    !base.package ||
    !manifest.package?.url ||
    !manifest.package.sha256 ||
    !supportsFingerprintVersion(manifest.version)
  )
    return false
  const expectedId =
    manifest.sourceType === 'custom'
      ? `fingerprint-chromium-custom-${manifest.version.replaceAll('.', '-')}-${manifest.package.sha256.toLowerCase().slice(0, 12)}`
      : fingerprintKernelId(manifest.version)
  return (
    (manifest.id === expectedId || (manifest.id === base.id && manifest.sourceType !== 'custom')) &&
    manifest.family === base.family &&
    manifest.executable === base.executable &&
    manifest.controlProtocol === base.controlProtocol &&
    manifest.configSchema === base.configSchema
  )
}
