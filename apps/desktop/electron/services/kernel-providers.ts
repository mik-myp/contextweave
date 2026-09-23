import type { KernelManifest, TargetArchitecture, TargetPlatform } from '@contextweave/contracts'
import { createFingerprintChromiumManifest } from '@contextweave/kernel-fingerprint-chromium'

// Downloadable provider registrations. Native browser discovery remains separate.
export const kernelProviders = [
  { id: 'fingerprint-chromium', label: 'Fingerprint Chromium', license: 'BSD-3-Clause' },
] as const
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
  return createFingerprintChromiumManifest(platform, arch)
}
