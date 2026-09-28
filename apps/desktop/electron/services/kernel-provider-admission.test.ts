import * as probe from './kernel-capability-probe'
import * as installation from './kernel-installation'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { bundledRelease, isPinnedOfficialPackage, reviewedReleases } from './kernel-catalog'
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
      const manifest = reviewedReleases(platform, arch).find(
        (entry) => entry.release.provider === providerId,
      )!.manifest!
      expect(supportsFingerprintVersion(release.version)).toBe(false)
      expect(isCompatibleFingerprintManifest(manifest)).toBe(true)
      expect(isPinnedOfficialPackage(manifest)).toBe(true)
      expect(requireKernelProvider(providerId).id).toBe(providerId)
      for (const change of [
        { source: 'https://github.com/other/browser' },
        { executable: '../outside' },
        { version: '152.0.7977.999' },
        { package: { ...manifest.package, sha256: 'a'.repeat(64) } },
        { dataDirCompatibility: ['148.0.7778.215'] },
      ]) {
        expect(isCompatibleFingerprintManifest({ ...manifest, ...change })).toBe(false)
        expect(isPinnedOfficialPackage({ ...manifest, ...change })).toBe(false)
      }
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
  it('rejects an unreviewed saved Apostate version before download or environment creation', async () => {
    const providerId = 'fingerprint-chromium-apostate'
    const release = fingerprintProviderRelease(providerId, 'win32', 'x64', '152.0.7977.83')!
    const manifest = {
      ...bundledRelease('win32', 'x64').manifest!,
      id: fingerprintKernelId('152.0.7977.999', providerId),
      providerId,
      version: '152.0.7977.999',
      package: { ...release.package },
      source: fingerprintProvider(providerId)!.source,
      dataDirCompatibility: [release.version],
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'))
    const { kernels, environments, repository } = fixture(manifest)
    expect(kernels.hasCompatibleProvider({ kernelId: manifest.id })).toBe(false)
    await expect(kernels.install(manifest.id)).rejects.toThrow('PROVIDER_UNVERIFIED')
    expect(() =>
      environments.create({ name: 'Unreviewed version', kernelId: manifest.id, commonConfig: {} }),
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

it('persists a custom display name without changing IDs or bindings and resets to the provider name', () => {
  const manifest = bundledRelease('win32', 'x64').manifest!
  const f = fixture(manifest)
  const original = f.kernels.list().find((item) => item.id === manifest.id)!
  expect(f.kernels.rename({ id: manifest.id, name: ' Work browser ' })).toMatchObject({
    id: manifest.id,
    label: 'Work browser',
    customName: 'Work browser',
    version: original.version,
  })
  const reopened = createKernelService(f.repository, 'win32', 'x64', join(f.root, 'kernels'))
  expect(reopened.list().find((item) => item.id === manifest.id)?.label).toBe('Work browser')
  expect(reopened.rename({ id: manifest.id, name: '' }).label).toBe(original.label)
  expect(() => reopened.rename({ id: '../outside', name: 'Bad' })).toThrow()
})
it('binds evidence to the executable, survives restart, and never promotes provider admission', async () => {
  const manifest = bundledRelease('win32', 'x64').manifest!,
    f = fixture(manifest)
  const evidence = {
    declared: true,
    state: 'verified' as const,
    version: manifest.version,
    checkedAt: new Date().toISOString(),
    evidence: 'offline-probe:fixture:v1',
  }
  vi.spyOn(probe, 'probeKernelCapabilities').mockResolvedValue({
    version: manifest.version,
    checkedAt: evidence.checkedAt,
    report: { cdp: evidence, timezone: evidence },
  })
  const result = await f.kernels.verify(manifest.id)
  expect(result.verification?.state).toBe('complete')
  expect(result.providerStatus).toBe('candidate')
  expect(result.capabilityReport.timezone.state).toBe('verified')
  const reopened = createKernelService(f.repository, 'win32', 'x64', join(f.root, 'kernels'))
  expect(
    reopened.list().find((item) => item.id === manifest.id)?.capabilityReport.timezone.state,
  ).toBe('verified')
  writeFileSync(join(f.installPath, 'chrome.exe'), 'changed fixture executable')
  expect(
    reopened.list().find((item) => item.id === manifest.id)?.capabilityReport.timezone.state,
  ).toBe('unverified')
})
it('keeps the verified install on probe failure and fences conflicting removal during a check', async () => {
  const manifest = bundledRelease('win32', 'x64').manifest!,
    f = fixture(manifest)
  let fail!: (error: Error) => void
  const check = vi.spyOn(probe, 'probeKernelCapabilities').mockReturnValue(
    new Promise((_, reject) => {
      fail = reject
    }),
  )
  const pending = f.kernels.verify(manifest.id)
  expect(f.kernels.verify(manifest.id)).toBe(pending)
  await expect(f.kernels.remove(manifest.id)).rejects.toThrow('OPERATION_IN_PROGRESS')
  fail(new Error('/private/secret'))
  const result = await pending
  expect(check).toHaveBeenCalledOnce()
  expect(result.status).toBe('available')
  expect(result.verification).toEqual({ state: 'failed', errorCode: 'KERNEL_PROBE_FAILED' })
  expect(result.capabilityReport.cdp.state).toBe('failed')
  expect(JSON.stringify(result)).not.toContain('secret')
})
it('automatically probes only after installation metadata is committed and retains a failed-check package', async () => {
  const manifest = bundledRelease('win32', 'x64').manifest!,
    f = fixture(manifest)
  const record = f.repository.getKernelInstallation(manifest.id, manifest.version, 'win32', 'x64')!
  f.repository.deleteKernelInstallation(record.id)
  vi.spyOn(installation, 'installBrowserPackage').mockResolvedValue({
    installPath: f.installPath,
    executablePath: join(f.installPath, manifest.executable),
    sizeBytes: 64,
  })
  const check = vi.spyOn(probe, 'probeKernelCapabilities').mockImplementation(async () => {
    expect(
      f.repository.getKernelInstallation(manifest.id, manifest.version, 'win32', 'x64')?.state,
    ).toBe('installed')
    throw new Error('test failure')
  })
  const result = await f.kernels.install(manifest.id, 'Work browser')
  expect(result.label).toBe('Work browser')
  expect(result.id).toBe(manifest.id)
  expect(check).toHaveBeenCalledOnce()
  expect(result.status).toBe('available')
  expect(result.installation?.phase).toBe('complete')
  expect(result.verification?.state).toBe('failed')
})

it('does not treat usage metadata changes as an executable content change', async () => {
  const manifest = bundledRelease('win32', 'x64').manifest!,
    f = fixture(manifest)
  vi.spyOn(probe, 'probeKernelCapabilities').mockImplementation(async () => {
    chmodSync(join(f.installPath, 'chrome.exe'), 0o700)
    const checkedAt = new Date().toISOString()
    return {
      version: manifest.version,
      checkedAt,
      report: {
        cdp: {
          declared: true,
          state: 'verified',
          version: manifest.version,
          checkedAt,
          evidence: 'fixture',
        },
      },
    }
  })
  const result = await f.kernels.verify(manifest.id)
  expect(result.verification?.state).toBe('complete')
  expect(result.capabilityReport.cdp.state).toBe('verified')
})
it('uses a newer runtime handshake instead of hiding it behind a failed earlier offline probe', async () => {
  const manifest = bundledRelease('win32', 'x64').manifest!,
    f = fixture(manifest)
  vi.spyOn(probe, 'probeKernelCapabilities').mockRejectedValue(new Error('fixture'))
  await f.kernels.verify(manifest.id)
  expect(f.kernels.list().find((item) => item.id === manifest.id)?.capabilityReport.cdp.state).toBe(
    'failed',
  )
  const record = f.environments.create({
    name: 'Fixture environment',
    kernelId: manifest.id,
    commonConfig: {},
  })
  f.kernels.observeCdp(record, manifest.version)
  expect(f.kernels.list().find((item) => item.id === manifest.id)?.capabilityReport.cdp.state).toBe(
    'verified',
  )
})
it('does not overwrite a saved name when the download fails before installation', async () => {
  const manifest = bundledRelease('win32', 'x64').manifest!,
    f = fixture(manifest)
  const record = f.repository.getKernelInstallation(manifest.id, manifest.version, 'win32', 'x64')!
  f.repository.deleteKernelInstallation(record.id)
  f.repository.setSetting(`kernel-name:${manifest.id}`, 'Previous name')
  vi.spyOn(installation, 'installBrowserPackage').mockRejectedValue(new Error('DOWNLOAD_FAILED'))
  await expect(f.kernels.install(manifest.id, 'New name')).rejects.toThrow('DOWNLOAD_FAILED')
  expect(f.repository.getSetting(`kernel-name:${manifest.id}`)).toBe('Previous name')
})
