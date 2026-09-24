import { z } from 'zod'
import { gt, prerelease, valid } from 'semver'
import {
  appUpdateReleaseSchema,
  type AppUpdateRelease,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'

export const appReleaseRepository = 'https://github.com/mik-myp/contextweave'
const latestReleaseApi = 'https://api.github.com/repos/mik-myp/contextweave/releases/latest'
const githubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().datetime(),
  assets: z
    .array(
      z.object({
        name: z.string(),
        browser_download_url: z.string().url(),
        size: z.number().int().nonnegative(),
        digest: z.string().nullable().optional(),
        state: z.string(),
      }),
    )
    .max(200),
})

export function selectAppUpdate(
  input: unknown,
  currentVersion: string,
  platform: TargetPlatform,
  arch: TargetArchitecture,
): AppUpdateRelease | undefined {
  const parsed = githubReleaseSchema.safeParse(input)
  if (!parsed.success || !valid(currentVersion)) throw new Error('UPDATE_RELEASE_INVALID')
  const release = parsed.data
  const version = valid(release.tag_name)
  if (
    release.draft ||
    release.prerelease ||
    !version ||
    prerelease(version) !== null ||
    release.tag_name !== `v${version}`
  )
    throw new Error('UPDATE_RELEASE_INVALID')
  if (!gt(version, currentVersion)) return undefined
  const suffix =
    platform === 'win32' && arch === 'x64'
      ? 'win-x64-setup.exe'
      : platform === 'darwin'
        ? `mac-${arch}.dmg`
        : undefined
  const fileName = suffix ? `ContextWeave-${version}-${suffix}` : undefined
  const asset = release.assets.find((item) => item.name === fileName && item.state === 'uploaded')
  const releaseUrl = `${appReleaseRepository}/releases/tag/${release.tag_name}`
  if (
    asset &&
    (asset.browser_download_url !==
      `${appReleaseRepository}/releases/download/${release.tag_name}/${fileName}` ||
      asset.size <= 0 ||
      asset.size > 800_000_000)
  )
    throw new Error('UPDATE_RELEASE_INVALID')
  if (asset && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? ''))
    throw new Error('UPDATE_CHECKSUM_UNAVAILABLE')
  return appUpdateReleaseSchema.parse({
    version,
    url: releaseUrl,
    publishedAt: release.published_at,
    asset: asset
      ? {
          fileName: asset.name,
          url: asset.browser_download_url,
          sizeBytes: asset.size,
          sha256: asset.digest!.slice(7).toLowerCase(),
        }
      : undefined,
  })
}

export async function fetchAppRelease(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(latestReleaseApi, {
    signal,
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ContextWeave',
    },
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(
      response.status === 403 || response.status === 429
        ? 'UPDATE_RATE_LIMITED'
        : 'UPDATE_CHECK_FAILED',
    )
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (let item = await reader.read(); !item.done; item = await reader.read()) {
      received += item.value.byteLength
      if (received > 2_000_000) throw new Error('UPDATE_RELEASE_INVALID')
      chunks.push(item.value)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new Error('UPDATE_RELEASE_INVALID')
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
