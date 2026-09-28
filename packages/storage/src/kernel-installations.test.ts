import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { kernelManifestSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from './index'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-kernel-commit-'))
  const database = openLocalDatabase(join(root, 'metadata.sqlite'))
  cleanups.push(() => {
    database.close()
    rmSync(root, { recursive: true, force: true })
  })
  const repository = new EnvironmentRepository(database.sqlite)
  const manifest = kernelManifestSchema.parse({
    id: 'managed-one',
    family: 'chromium',
    version: '123.0.0.1',
    platform: 'win32',
    arch: 'x64',
    executable: 'chrome.exe',
    controlProtocol: 'cdp',
    configSchema: 'fixture',
    dataDirCompatibility: ['123.0.0.1'],
    license: 'MIT',
    capabilities: {
      cdp: true,
      screenshot: true,
      fileUpload: true,
      elementScreenshot: true,
      userAgent: true,
      timezone: true,
      proxy: true,
      webRtcPolicy: true,
    },
  })
  const installation = {
    kernelId: manifest.id,
    version: manifest.version,
    platform: manifest.platform,
    arch: manifest.arch,
    sourceUrl: null,
    sha256: null,
    installPath: join(root, 'kernels', 'one'),
    state: 'installed' as const,
  }
  return { repository, database, manifest, installation }
}
it('atomically records a trimmed installation name without changing kernel identity', () => {
  const { repository, manifest, installation } = fixture()
  expect(
    repository.commitKernelInstallation(installation, manifest, ' Work browser ').kernelId,
  ).toBe(manifest.id)
  expect(repository.getSetting(`kernel-name:${manifest.id}`)).toBe('Work browser')
  expect(repository.getSetting(`kernel-manifest:${manifest.id}`)).toEqual(manifest)
  repository.commitKernelInstallation(installation, manifest)
  expect(repository.getSetting(`kernel-name:${manifest.id}`)).toBe('Work browser')
  repository.commitKernelInstallation(installation, manifest, '')
  expect(repository.getSetting(`kernel-name:${manifest.id}`)).toBe('')
})
it('rolls back the installation and manifest if saving the name fails', () => {
  const { repository, database, manifest, installation } = fixture()
  database.sqlite.exec(`CREATE TRIGGER refuse_test_kernel_name BEFORE INSERT ON app_settings
    WHEN NEW.key = 'kernel-name:managed-one' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`)
  expect(() =>
    repository.commitKernelInstallation(installation, manifest, 'Work browser'),
  ).toThrow()
  expect(repository.listKernelInstallations()).toEqual([])
  expect(repository.getSetting(`kernel-manifest:${manifest.id}`)).toBeUndefined()
  expect(repository.getSetting(`kernel-name:${manifest.id}`)).toBeUndefined()
})
it('refuses a mismatched manifest or invalid name before writing any installation metadata', () => {
  const { repository, manifest, installation } = fixture()
  expect(() =>
    repository.commitKernelInstallation(
      installation,
      { ...manifest, id: 'another' },
      'Work browser',
    ),
  ).toThrow('KERNEL_MANIFEST_MISMATCH')
  expect(() =>
    repository.commitKernelInstallation(installation, manifest, 'x'.repeat(81)),
  ).toThrow()
  expect(repository.listKernelInstallations()).toEqual([])
  expect(repository.getSetting(`kernel-manifest:${manifest.id}`)).toBeUndefined()
})
