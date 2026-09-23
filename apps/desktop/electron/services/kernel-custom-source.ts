import {
  customKernelSourceSchema,
  type CustomKernelSource,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'
import type { CatalogEntry } from './kernel-catalog'
import { providerManifest } from './kernel-providers'

export function publicDownloadSource(url: string): string {
  const parsed = new URL(url)
  parsed.search = ''
  parsed.hash = ''
  return parsed.href
}
export function createCustomKernelEntry(
  input: CustomKernelSource,
  platform: TargetPlatform,
  arch: TargetArchitecture,
): CatalogEntry {
  const parsed = customKernelSourceSchema.parse(input)
  const base = providerManifest(parsed.providerId, platform, arch)
  if (!parsed.trustedSource || !parsed.version || !parsed.sha256)
    throw new Error('CUSTOM_SOURCE_DETAILS_REQUIRED')
  if (![136, 138, 139, 142, 144, 148].includes(Number(parsed.version.split('.')[0])))
    throw new Error('ADAPTER_UNSUPPORTED')
  if (!(platform === 'win32' && arch === 'x64') && !(platform === 'darwin' && arch === 'arm64'))
    throw new Error('PLATFORM_UNSUPPORTED')
  const sha256 = parsed.sha256.toLowerCase()
  const id = `${parsed.providerId}-custom-${parsed.version.replaceAll('.', '-')}-${sha256.slice(0, 12)}`
  const source = publicDownloadSource(parsed.url)
  return {
    manifest: {
      ...base,
      id,
      version: parsed.version,
      sourceType: 'custom',
      source,
      dataDirCompatibility: [parsed.version],
      package: { url: parsed.url, sha256 },
    },
    release: {
      id,
      provider: parsed.providerId,
      sourceType: 'custom',
      version: parsed.version,
      platform,
      arch,
      source,
      sha256,
      installable: true,
      installed: false,
    },
  }
}
