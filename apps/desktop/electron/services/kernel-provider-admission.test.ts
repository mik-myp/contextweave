import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { bundledRelease, isPinnedOfficialPackage } from './kernel-catalog'
import { createCustomKernelEntry } from './kernel-custom-source'
import { createKernelService } from './kernel-service'
import * as kernelService from './kernel-service'
import { createEnvironmentService } from './environment-service'
import { checkEnvironment } from './preflight'
import {
  fingerprintKernelId,
  fingerprintProvider,
  fingerprintProviderRelease,
} from '@contextweave/kernel-fingerprint-chromium'
import {
  isCompatibleFingerprintManifest,
  requireKernelProvider,
  supportsFingerprintVersion,
} from './kernel-providers'
import type { KernelManifest } from '@contextweave/contracts'

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture(manifest: KernelManifest) {
  const root = mkdtempSync(join(tmpdir(), 'cw-provider-admission-'))
  const db = openLocalDatabase(join(root, 'metadata.sqlite'))
  cleanups.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const repository = new EnvironmentRepository(db.sqlite)
  const installPath = join(root, 'kernels', manifest.id)
  mkdirSync(installPath, { recursive: true })
  writeFileSync(join(installPath, 'chrome.exe'), 'non-executable fixture')
  repository.setSetting(`kernel-manifest:${manifest.id}`, manifest)
  repository.recordKernelInstallation({
    kernelId: manifest.id,
    version: manifest.version,
    platform: 'win32',
    arch: 'x64',
    installPath,
    sourceUrl: manifest.package!.url!,
    sha256: manifest.package!.sha256!,
    state: 'installed',
  })
  const kernels = createKernelService(repository, 'win32', 'x64', join(root, 'kernels'))
  const environments = createEnvironmentService(
    repository,
    kernels,
    join(root, 'environments'),
    'win32',
    'x64',
  )
  return { repository, kernels, environments, installPath, root }
}

describe('runtime provider admission is separate from verification labels', () => {
  it.each(['official', 'custom'] as const)(
    'keeps an installed %s candidate usable without claiming verified fingerprint capabilities',
    async (source) => {
      const manifest =
        source === 'official'
          ? bundledRelease('win32', 'x64').manifest!
          : createCustomKernelEntry(
              {
                providerId: 'fingerprint-chromium',
                url: 'https://mirror.example.test/core.zip',
                version: '148.0.7778.215',
                sha256: 'b'.repeat(64),
                trustedSource: true,
              },
              'win32',
              'x64',
            ).manifest!
      const { kernels, environments, repository } = fixture(manifest)
      expect(kernels.list().find((kernel) => kernel.id === manifest.id)?.providerStatus).toBe(
        'candidate',
      )
      const record = environments.create({
        name: 'Candidate environment',
        kernelId: manifest.id,
        commonConfig: { language: 'system', timezone: 'system' },
      })
      expect(kernels.hasCompatibleProvider(record)).toBe(true)
      vi.spyOn(kernelService, 'readExecutableVersion').mockResolvedValue(manifest.version)
      const report = await checkEnvironment(record, repository, kernels, { read: () => undefined })
      expect(report.issues.map((issue) => issue.code)).not.toContain('PROVIDER_UNVERIFIED')
      expect(report.issues.map((issue) => issue.code)).not.toContain('KERNEL_UNAVAILABLE')
      kernels.observeCdp(record, manifest.version)
      const summary = kernels.list().find((kernel) => kernel.id === manifest.id)!
      expect(summary.providerStatus).toBe('candidate')
      expect(summary.capabilityReport.cdp.state).toBe('verified')
      expect(summary.capabilityReport.timezone.state).toBe('unverified')
    },
  )
  it('reopens a legacy environment without rewriting its manifest, profile, version or identity', () => {
    const manifest = { ...bundledRelease('win32', 'x64').manifest! }
    delete manifest.providerId
    const { repository, environments, root } = fixture(manifest)
    const record = environments.create({
      name: 'Existing identity',
      kernelId: manifest.id,
      commonConfig: {},
    })
    const before = repository.get(record.environmentId)
    expect(before).toBeDefined()
    writeFileSync(join(record.dataDir, 'sentinel'), 'existing profile')
    const reopened = createKernelService(repository, 'win32', 'x64', join(root, 'kernels'))
    expect(reopened.hasCompatibleProvider(record)).toBe(true)
    expect(reopened.list().find((kernel) => kernel.id === manifest.id)).toMatchObject({
      status: 'available',
      providerStatus: 'candidate',
      version: manifest.version,
    })
    expect(repository.get(record.environmentId)).toEqual(before)
    expect(repository.getSetting(`kernel-manifest:${manifest.id}`)).toEqual(manifest)
    expect(readFileSync(join(record.dataDir, 'sentinel'), 'utf8')).toBe('existing profile')
  })
  it('does not let a display label or arbitrary registry entry authorize an unknown adapter', () => {
    const manifest = bundledRelease('win32', 'x64').manifest!
    const { kernels, environments } = fixture(manifest)
    const existing = kernels.registry.get(manifest.id)
    // Deliberately bypass the production registration path: its labels cannot grant access.
    const getManifest = () => ({ ...manifest, id: 'unknown-adapter' })
    const foreign = {
      getManifest,
      getCapabilities: () => manifest.capabilities,
      validateConfig: () => ({ ok: true as const }),
      buildLaunchPlan: existing.buildLaunchPlan.bind(existing),
    }
    kernels.registry.register(foreign)
    vi.spyOn(kernels, 'list').mockReturnValue([
      {
        ...kernels.list()[0],
        id: 'unknown-adapter',
        providerStatus: 'verified',
        status: 'available',
      },
    ])
    expect(kernels.hasCompatibleProvider({ kernelId: 'unknown-adapter' })).toBe(false)
    expect(() =>
      environments.create({ name: 'Unknown', kernelId: 'unknown-adapter', commonConfig: {} }),
    ).toThrow('PROVIDER_UNVERIFIED')
    expect(kernels.hasCompatibleProvider({ kernelId: 'not-registered' })).toBe(false)
    expect(
      kernels.hasCompatibleProvider({ kernelId: manifest.id, kernelVersion: '148.0.7778.999' }),
    ).toBe(false)
  })
  it.each([
    { providerId: 'fingerprint-chromium-pocchian-intel' },
    { source: 'https://github.com/other/fingerprint-chromium' },
  ])(
    'rejects a saved publisher collision without migrating the existing environment: %j',
    async (change) => {
      const original = {
        ...bundledRelease('win32', 'x64').manifest!,
        id: 'fingerprint-chromium-144-0-7559-132',
        version: '144.0.7559.132',
        dataDirCompatibility: ['144.0.7559.132'],
      }
      const { kernels, environments, repository } = fixture({ ...original, ...change })
      expect(kernels.hasCompatibleProvider({ kernelId: original.id })).toBe(false)
      expect(() =>
        environments.create({
          name: 'No implicit migration',
          kernelId: original.id,
          commonConfig: {},
        }),
      ).toThrow('PROVIDER_UNVERIFIED')
      await expect(kernels.install(original.id)).rejects.toThrow('PROVIDER_UNVERIFIED')
      expect(repository.listAll()).toHaveLength(0)
      expect(repository.getSetting(`kernel-manifest:${original.id}`)).toEqual({
        ...original,
        ...change,
      })
    },
  )
  it.each([
    ['fingerprint-chromium-pocchian-intel', 'darwin', 'x64', '152.0.7977.82'],
    ['fingerprint-chromium-apostate', 'darwin', 'arm64', '152.0.7977.83'],
    ['fingerprint-chromium-apostate', 'win32', 'x64', '152.0.7977.83'],
  ] as const)(
    'does not open the generic whitelist or custom route for %s on %s/%s',
    (providerId, platform, arch, version) => {
      const release = fingerprintProviderRelease(providerId, platform, arch, version)!
      const manifest = {
        ...bundledRelease('win32', 'x64').manifest!,
        id: fingerprintKernelId(release.version, providerId),
        providerId,
        version: release.version,
        platform: release.platform,
        arch: release.arch,
        package: { ...release.package },
        source: fingerprintProvider(providerId)!.source,
        executable: platform === 'darwin' ? 'Chromium.app/Contents/MacOS/Chromium' : 'chrome.exe',
      }
      expect(supportsFingerprintVersion(release.version)).toBe(false)
      expect(isCompatibleFingerprintManifest(manifest)).toBe(false)
      expect(isPinnedOfficialPackage(manifest)).toBe(false)
      expect(() => requireKernelProvider(providerId)).toThrow('PROVIDER_UNVERIFIED')
      expect(() =>
        createCustomKernelEntry(
          {
            providerId,
            url: release.package.url,
            version: release.version,
            sha256: release.package.sha256,
            trustedSource: true,
          },
          platform,
          arch,
        ),
      ).toThrow('PROVIDER_UNVERIFIED')
    },
  )
  it('rejects a saved Apostate payload before download or environment creation', async () => {
    const providerId = 'fingerprint-chromium-apostate'
    const release = fingerprintProviderRelease(providerId, 'win32', 'x64', '152.0.7977.83')!
    const manifest = {
      ...bundledRelease('win32', 'x64').manifest!,
      id: fingerprintKernelId(release.version, providerId),
      providerId,
      version: release.version,
      package: { ...release.package },
      source: fingerprintProvider(providerId)!.source,
      dataDirCompatibility: [release.version],
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'))
    const { kernels, environments, repository } = fixture(manifest)
    expect(kernels.hasCompatibleProvider({ kernelId: manifest.id })).toBe(false)
    await expect(kernels.install(manifest.id)).rejects.toThrow('PROVIDER_UNVERIFIED')
    expect(() =>
      environments.create({ name: 'Audit only', kernelId: manifest.id, commonConfig: {} }),
    ).toThrow('PROVIDER_UNVERIFIED')
    expect(fetch).not.toHaveBeenCalled()
    expect(repository.listAll()).toHaveLength(0)
    expect(repository.getSetting(`kernel-manifest:${manifest.id}`)).toEqual(manifest)
  })
  it('refuses incompatible saved manifests and missing installed payloads', async () => {
    const manifest = {
      ...bundledRelease('win32', 'x64').manifest!,
      id: 'fingerprint-chromium-144-0-7559-132',
      version: '144.0.7559.132',
      executable: '../not-a-browser',
    }
    const { kernels, environments } = fixture(manifest)
    expect(kernels.hasCompatibleProvider({ kernelId: manifest.id })).toBe(false)
    expect(() =>
      environments.create({ name: 'Incompatible', kernelId: manifest.id, commonConfig: {} }),
    ).toThrow('PROVIDER_UNVERIFIED')
    const supported = fixture(bundledRelease('win32', 'x64').manifest!)
    rmSync(supported.installPath, { recursive: true })
    expect(() =>
      supported.environments.create({
        name: 'Missing',
        kernelId: bundledRelease('win32', 'x64').release.id,
        commonConfig: {},
      }),
    ).toThrow('KERNEL_UNAVAILABLE')
  })
})
