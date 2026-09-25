import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { environmentConfigSchema } from '@contextweave/contracts'
import { bundledRelease, parseOfficialReleases } from './kernel-catalog'
import { createKernelService } from './kernel-service'
import { installBrowserPackage } from './kernel-installation'

vi.mock('./kernel-installation', () => ({ installBrowserPackage: vi.fn() }))
function row(version = '148.0.7778.215') {
  const manifest = bundledRelease('win32', 'x64').manifest!
  const name = `ungoogled-chromium_${version}-1.1_windows_x64.zip`
  return {
    tag_name: version,
    draft: false,
    prerelease: false,
    published_at: null,
    assets: [
      {
        name,
        size: manifest.package!.sizeBytes!,
        digest: `sha256:${manifest.package!.sha256}`,
        browser_download_url: `https://github.com/adryfish/fingerprint-chromium/releases/download/${version}/${name}`,
      },
    ],
  }
}

describe('official download trust admission', () => {
  it('does not approve a new patch release merely because its Chromium major is supported', () => {
    const [entry] = parseOfficialReleases([row('148.0.7778.999')], 'win32', 'x64')
    expect(entry.release).toMatchObject({ installable: false, reason: 'RELEASE_UNREVIEWED' })
    expect(entry.manifest).toBeUndefined()
  })
  it.each(['digest', 'size', 'asset-name'] as const)(
    'rejects a changed %s for the fixed version',
    (field) => {
      const release = row()
      if (field === 'digest') release.assets[0].digest = `sha256:${'f'.repeat(64)}`
      if (field === 'size') release.assets[0].size++
      if (field === 'asset-name') {
        release.assets[0].name = 'replacement_windows_x64.zip'
        release.assets[0].browser_download_url = `https://github.com/adryfish/fingerprint-chromium/releases/download/${release.tag_name}/${release.assets[0].name}`
      }
      const [entry] = parseOfficialReleases([release], 'win32', 'x64')
      expect(entry.release).toMatchObject({ installable: false, reason: 'RELEASE_UNREVIEWED' })
      expect(entry.manifest).toBeUndefined()
    },
  )
  it('retains an installed legacy identity but rejects redownload through its saved manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-kernel-trust-'))
    const db = openLocalDatabase(join(root, 'db.sqlite'))
    try {
      const repository = new EnvironmentRepository(db.sqlite)
      const manifest = {
        ...bundledRelease('win32', 'x64').manifest!,
        id: 'fingerprint-chromium-144-0-7559-132',
        version: '144.0.7559.132',
        dataDirCompatibility: ['144.0.7559.132'],
      }
      const installPath = join(root, 'kernels', 'legacy')
      mkdirSync(installPath, { recursive: true })
      writeFileSync(join(installPath, manifest.executable), 'fixture; not executable')
      repository.setSetting(`kernel-manifest:${manifest.id}`, manifest)
      repository.recordKernelInstallation({
        kernelId: manifest.id,
        version: manifest.version,
        platform: 'win32',
        arch: 'x64',
        sourceUrl: manifest.package!.url!,
        sha256: manifest.package!.sha256!,
        installPath,
        state: 'installed',
      })
      repository.create({
        config: environmentConfigSchema.parse({
          environmentId: 'env-pinned',
          name: 'Pinned',
          kernelId: manifest.id,
          kernelVersion: manifest.version,
          commonConfig: {},
          kernelConfig: {},
        }),
        dataDir: join(root, 'profile'),
        platform: 'win32',
        arch: 'x64',
      })
      const kernels = createKernelService(repository, 'win32', 'x64', join(root, 'kernels'))
      expect(kernels.list().find((kernel) => kernel.id === manifest.id)).toMatchObject({
        status: 'available',
        providerStatus: 'candidate',
      })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture offline')))
      const retained = (await kernels.catalog()).releases.find(
        (release) => release.id === manifest.id,
      )
      expect(retained).toMatchObject({
        installed: true,
        installable: false,
        retained: true,
        reason: 'RELEASE_UNREVIEWED',
      })
      rmSync(installPath, { recursive: true })
      await expect(kernels.install(manifest.id)).rejects.toThrow('RELEASE_UNREVIEWED')
      expect(installBrowserPackage).not.toHaveBeenCalled()
      expect(repository.get('env-pinned')?.kernelVersion).toBe(manifest.version)
    } finally {
      vi.unstubAllGlobals()
      vi.clearAllMocks()
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
