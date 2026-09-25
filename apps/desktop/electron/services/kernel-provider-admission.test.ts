import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { bundledRelease } from './kernel-catalog'
import { createCustomKernelEntry } from './kernel-custom-source'
import { createKernelService } from './kernel-service'
import * as kernelService from './kernel-service'
import { createEnvironmentService } from './environment-service'
import { checkEnvironment } from './preflight'
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
  return { repository, kernels, environments, installPath }
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
