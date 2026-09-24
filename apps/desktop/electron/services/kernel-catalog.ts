import { z } from 'zod'
import type {
  KernelManifest,
  KernelRelease,
  TargetArchitecture,
  TargetPlatform,
} from '@contextweave/contracts'
import {
  createFingerprintChromiumManifest,
  fingerprintKernelId,
} from '@contextweave/kernel-fingerprint-chromium'

export const officialReleasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().nullable(),
    assets: z.array(
      z.object({
        name: z.string(),
        size: z.number().int().positive(),
        digest: z.string().nullable(),
        browser_download_url: z.string().url(),
      }),
    ),
  }),
)
export type CatalogEntry = { release: KernelRelease; manifest?: KernelManifest }
export function parseOfficialReleases(
  value: unknown,
  platform: TargetPlatform,
  arch: TargetArchitecture,
): CatalogEntry[] {
  const base = createFingerprintChromiumManifest(platform, arch)
  return officialReleasesSchema
    .parse(value)
    .filter(
      (release) =>
        !release.draft && !release.prerelease && /^\d+\.\d+\.\d+\.\d+$/.test(release.tag_name),
    )
    .map((item) => {
      const version = item.tag_name
      const id = fingerprintKernelId(version)
      const asset =
        platform === 'win32' && arch === 'x64'
          ? item.assets.find((asset) => asset.name.endsWith('_windows_x64.zip'))
          : platform === 'darwin' && arch === 'arm64'
            ? item.assets.find((asset) => asset.name.endsWith('_macos.dmg'))
            : undefined
      const major = Number(version.split('.')[0])
      const supported = [136, 138, 139, 142, 144, 148].includes(major)
      const checksum = asset?.digest?.match(/^sha256:([0-9a-f]{64})$/)?.[1]
      const expectedPrefix = `https://github.com/adryfish/fingerprint-chromium/releases/download/${version}/`
      const validSource = Boolean(
        asset &&
        asset.browser_download_url === `${expectedPrefix}${asset.name}` &&
        /^[a-zA-Z0-9_.-]+$/.test(asset.name),
      )
      const reason = !supported
        ? 'ADAPTER_UNSUPPORTED'
        : !asset
          ? 'PLATFORM_UNSUPPORTED'
          : !checksum || !validSource
            ? 'CHECKSUM_UNAVAILABLE'
            : undefined
      const release: KernelRelease = {
        id,
        provider: 'fingerprint-chromium',
        version,
        platform,
        arch,
        publishedAt: item.published_at ?? undefined,
        source: `https://github.com/adryfish/fingerprint-chromium/releases/tag/${version}`,
        sizeBytes: asset?.size,
        sha256: checksum,
        installable: !reason,
        installed: false,
        reason,
      }
      return {
        release,
        manifest:
          !reason && asset
            ? {
                ...base,
                id,
                version,
                dataDirCompatibility: [version],
                package: {
                  url: asset.browser_download_url,
                  sha256: checksum,
                  sizeBytes: asset.size,
                },
              }
            : undefined,
      }
    })
    .sort((a, b) =>
      b.release.version.localeCompare(a.release.version, undefined, { numeric: true }),
    )
}
export function bundledRelease(platform: TargetPlatform, arch: TargetArchitecture): CatalogEntry {
  const manifest = createFingerprintChromiumManifest(platform, arch)
  manifest.id = fingerprintKernelId(manifest.version)
  return {
    manifest: manifest.package ? manifest : undefined,
    release: {
      id: manifest.id,
      provider: 'fingerprint-chromium',
      version: manifest.version,
      platform,
      arch,
      publishedAt: '2026-06-21T04:34:00Z',
      source: `https://github.com/adryfish/fingerprint-chromium/releases/tag/${manifest.version}`,
      sizeBytes: manifest.package?.sizeBytes,
      sha256: manifest.package?.sha256,
      installable: Boolean(manifest.package),
      installed: false,
      reason: manifest.package ? undefined : 'PLATFORM_UNSUPPORTED',
    },
  }
}
export async function fetchOfficialReleases(): Promise<unknown> {
  const response = await fetch(
    'https://api.github.com/repos/adryfish/fingerprint-chromium/releases?per_page=30',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ContextWeave',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    },
  )
  if (!response.ok || !response.body) throw new Error('CATALOG_UNAVAILABLE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (let item = await reader.read(); !item.done; item = await reader.read()) {
      size += item.value.byteLength
      if (size > 2_000_000) throw new Error('CATALOG_UNAVAILABLE')
      chunks.push(item.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
