import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { bundledRelease, parseOfficialReleases } from './kernel-catalog'
import { createKernelService } from './kernel-service'
import { createEnvironmentService } from './environment-service'
function release(version: string) {
  const name = `ungoogled-chromium_${version}-1.1_windows_x64.zip`
  return {
    tag_name: version,
    draft: false,
    prerelease: false,
    published_at: '2026-06-21T04:34:00Z',
    assets: [
      {
        name,
        size: 189767686,
        digest: 'sha256:9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579',
        browser_download_url: `https://github.com/adryfish/fingerprint-chromium/releases/download/${version}/${name}`,
      },
    ],
  }
}
describe('versioned official kernel catalog', () => {
  it('only offers compatible official packages with a trusted checksum', () => {
    const missing = release('139.0.7258.154')
    missing.assets[0].digest = ''
    const forged = release('142.0.7444.175')
    forged.assets[0].browser_download_url = 'https://example.com/malicious.zip'
    const entries = parseOfficialReleases(
      [release('148.0.7778.215'), release('999.0.0.1'), missing, forged],
      'win32',
      'x64',
    )
    expect(
      entries.filter((entry) => entry.release.installable).map((entry) => entry.release.version),
    ).toEqual(['148.0.7778.215'])
    expect(entries.find((entry) => entry.release.version.startsWith('999'))?.release.reason).toBe(
      'ADAPTER_UNSUPPORTED',
    )
    expect(
      parseOfficialReleases([release('148.0.7778.215')], 'darwin', 'arm64')[0].release.reason,
    ).toBe('PLATFORM_UNSUPPORTED')
  })
  it('lists installed versions only and binds each environment to its chosen version and persistent seed', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-kernel-catalog-'))
    const db = openLocalDatabase(join(root, 'data.sqlite'))
    try {
      const repository = new EnvironmentRepository(db.sqlite)
      const raw = [release('148.0.7778.215'), release('144.0.7559.132')]
      repository.setSetting('kernel-release-catalog', raw)
      expect(
        createKernelService(repository, 'win32', 'x64')
          .list()
          .filter((kernel) => kernel.id.startsWith('fingerprint')),
      ).toEqual([])
      const current = bundledRelease('win32', 'x64').manifest!
      const legacy = {
        ...current,
        id: 'fingerprint-chromium-144-0-7559-132',
        version: '144.0.7559.132',
        dataDirCompatibility: ['144.0.7559.132'],
      }
      // Actual installs persist manifests. A prior version remains usable without
      // allowing its old cached catalog row to authorize a fresh download.
      for (const manifest of [current, legacy]) {
        repository.setSetting(`kernel-manifest:${manifest.id}`, manifest)
        const installPath = join(root, manifest.id)
        mkdirSync(installPath)
        writeFileSync(join(installPath, 'chrome.exe'), 'fixture')
        repository.recordKernelInstallation({
          kernelId: manifest!.id,
          version: manifest!.version,
          platform: 'win32',
          arch: 'x64',
          sourceUrl: manifest!.package!.url!,
          sha256: manifest!.package!.sha256!,
          installPath,
          state: 'installed',
        })
      }
      const kernels = createKernelService(repository, 'win32', 'x64')
      const installed = kernels.list().filter((kernel) => kernel.id.startsWith('fingerprint'))
      expect(installed).toHaveLength(2)
      const environments = createEnvironmentService(
        repository,
        kernels,
        join(root, 'environments'),
        'win32',
        'x64',
      )
      const a = environments.create({ name: 'A', kernelId: installed[0].id, commonConfig: {} })
      const b = environments.create({ name: 'B', kernelId: installed[1].id, commonConfig: {} })
      expect(a.kernelVersion).not.toBe(b.kernelVersion)
      const identity = JSON.parse(a.configJson).kernelConfig
      expect(identity.seed).toBeGreaterThan(0)
      expect(JSON.parse(repository.get(a.environmentId)!.configJson).kernelConfig).toEqual(identity)
      expect(JSON.parse(b.configJson).kernelConfig.seed).not.toBe(identity.seed)
      expect(
        kernels.executableFor({ kernelId: a.kernelId, kernelVersion: 'unsupported-other-version' }),
      ).toBeUndefined()
    } finally {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
