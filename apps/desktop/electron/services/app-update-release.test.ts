import { describe, expect, it, vi } from 'vitest'
import { appReleaseRepository, fetchAppRelease, selectAppUpdate } from './app-update-release'

function release(version = '0.2.0') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    body: 'Release notes',
    published_at: '2026-09-24T00:00:00Z',
    assets: ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64-portable.exe', 'win-x64-setup.exe'].map(
      (suffix) => {
        const name = `ContextWeave-${version}-${suffix}`
        return {
          name,
          state: 'uploaded',
          size: 100,
          digest: `sha256:${'a'.repeat(64)}`,
          browser_download_url: `${appReleaseRepository}/releases/download/v${version}/${name}`,
        }
      },
    ),
  }
}
describe('application release selection', () => {
  it.each([
    ['darwin', 'arm64', 'mac-arm64.dmg'],
    ['darwin', 'x64', 'mac-x64.dmg'],
    ['win32', 'x64', 'win-x64-setup.exe'],
  ] as const)('selects the native %s/%s installer', (platform, arch, suffix) => {
    expect(selectAppUpdate(release(), '0.1.0', platform, arch)?.asset?.fileName).toBe(
      `ContextWeave-0.2.0-${suffix}`,
    )
  })
  it('compares numeric versions and upgrades alpha to stable without offering downgrades', () => {
    expect(selectAppUpdate(release('0.10.0'), '0.9.0', 'darwin', 'arm64')?.version).toBe('0.10.0')
    expect(selectAppUpdate(release('0.1.0'), '0.1.0-alpha.9', 'darwin', 'arm64')?.version).toBe(
      '0.1.0',
    )
    expect(selectAppUpdate(release(), '0.2.0', 'darwin', 'arm64')).toBeUndefined()
    expect(selectAppUpdate(release(), '0.3.0', 'darwin', 'arm64')).toBeUndefined()
  })
  it('distinguishes an unsupported target from an up-to-date app', () => {
    expect(selectAppUpdate(release(), '0.1.0', 'linux', 'x64')).toMatchObject({
      version: '0.2.0',
      asset: undefined,
    })
    expect(selectAppUpdate({ ...release(), assets: [] }, '0.1.0', 'darwin', 'arm64')).toMatchObject(
      { asset: undefined },
    )
  })
  it('rejects drafts, prereleases, malformed versions, wrong asset origins and missing hashes', () => {
    for (const overrides of [
      { draft: true },
      { prerelease: true },
      { tag_name: 'v0.3.0-alpha.1' },
      { tag_name: 'latest' },
      { tag_name: 'v01.2.0' },
    ])
      expect(() =>
        selectAppUpdate({ ...release(), ...overrides }, '0.1.0', 'darwin', 'arm64'),
      ).toThrow('UPDATE_RELEASE_INVALID')
    const untrusted = release()
    untrusted.assets[0].browser_download_url = 'https://example.com/installer.dmg'
    expect(() => selectAppUpdate(untrusted, '0.1.0', 'darwin', 'arm64')).toThrow(
      'UPDATE_RELEASE_INVALID',
    )
    const noDigest = release()
    noDigest.assets[0].digest = ''
    expect(() => selectAppUpdate(noDigest, '0.1.0', 'darwin', 'arm64')).toThrow(
      'UPDATE_CHECKSUM_UNAVAILABLE',
    )
  })
  it('reports rate limiting, invalid JSON and oversized responses instead of claiming no update', async () => {
    await expect(
      fetchAppRelease(
        new AbortController().signal,
        vi.fn(async () => new Response('', { status: 403 })),
      ),
    ).rejects.toThrow('UPDATE_RATE_LIMITED')
    await expect(
      fetchAppRelease(
        new AbortController().signal,
        vi.fn(async () => new Response('<html>offline')),
      ),
    ).rejects.toThrow('UPDATE_RELEASE_INVALID')
    await expect(
      fetchAppRelease(
        new AbortController().signal,
        vi.fn(async () => new Response('x'.repeat(2_000_001))),
      ),
    ).rejects.toThrow('UPDATE_RELEASE_INVALID')
  })
})
