import { installBrowserPackage } from './kernel-installation'
import { rm } from 'node:fs/promises'
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { environmentConfigSchema } from '@contextweave/contracts'
import { bundledRelease } from './kernel-catalog'
import { createKernelService } from './kernel-service'
vi.mock('./kernel-installation', () => ({ installBrowserPackage: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rm: vi.fn(fs.rm) }
})
const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const clean of cleanups.splice(0).reverse()) clean()
})
function fixture(version?: string) {
  const root = mkdtempSync(join(tmpdir(), 'cw-remove-'))
  const kernelRoot = join(root, 'kernels')
  const manifest = bundledRelease('win32', 'x64').manifest!
  if (version) {
    manifest.version = version
    manifest.id = `fingerprint-chromium-${version.replaceAll('.', '-')}`
  }
  const installPath = join(kernelRoot, manifest.id, manifest.version, `win32-x64-${randomUUID()}`)
  mkdirSync(installPath, { recursive: true })
  writeFileSync(join(installPath, manifest.executable), 'fixture executable')
  const db = openLocalDatabase(join(root, 'metadata.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
  const installation = repository.recordKernelInstallation({
    kernelId: manifest.id,
    version: manifest.version,
    platform: 'win32',
    arch: 'x64',
    sourceUrl: manifest.package!.url!,
    sha256: manifest.package!.sha256!,
    installPath,
    state: 'installed',
  })
  repository.setSetting(`kernel-manifest:${manifest.id}`, manifest)
  const kernels = createKernelService(repository, 'win32', 'x64', kernelRoot)
  cleanups.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const environment = () => {
    const dataDir = join(root, 'environments', 'env-test')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'keep.txt'), 'private fixture')
    const record = repository.create({
      config: environmentConfigSchema.parse({
        environmentId: 'env-test',
        name: 'Test',
        kernelId: manifest.id,
        kernelVersion: manifest.version,
        commonConfig: {},
        kernelConfig: {},
      }),
      dataDir,
      platform: 'win32',
      arch: 'x64',
    })
    return record
  }
  return { root, manifest, installPath, repository, kernels, kernelRoot, installation, environment }
}
describe('managed kernel deletion', () => {
  it('deletes payload and installation only, preserving stopped and trashed environment data', async () => {
    const f = fixture()
    const record = f.environment()
    f.repository.deleteEnvironment(record.environmentId)
    expect(f.kernels.list().find((k) => k.id === f.manifest.id)).toMatchObject({
      removable: true,
      referenceCount: 1,
    })
    const before = f.repository.get(record.environmentId)
    expect(await f.kernels.remove(f.manifest.id)).toBe(true)
    expect(existsSync(f.installPath)).toBe(false)
    expect(f.repository.listKernelInstallations()).toEqual([])
    expect(f.repository.get(record.environmentId)).toEqual(before)
    expect(readFileSync(join(record.dataDir, 'keep.txt'), 'utf8')).toBe('private fixture')
    expect(f.kernels.executableFor(record)).toBeUndefined()
  })
  it.each(['starting', 'running', 'stopping', 'needs-recovery'] as const)(
    'blocks a %s environment even without a live session in this client',
    async (state) => {
      const f = fixture()
      const record = f.environment()
      f.repository.updateStatus(record.environmentId, state)
      await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('KERNEL_IN_USE')
      expect(existsSync(f.installPath)).toBe(true)
    },
  )
  it('blocks orphan/unreadable locks and does not delete native browsers', async () => {
    const f = fixture()
    const record = f.environment()
    mkdirSync(join(record.dataDir, '.runtime.lock'))
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('KERNEL_IN_USE')
    await expect(f.kernels.remove('standard-chromium')).rejects.toThrow('KERNEL_NOT_MANAGED')
  })
  it('fences launch, install and repeated removal before any asynchronous deletion', async () => {
    const f = fixture()
    const release = f.kernels.retain(f.manifest.id)
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('OPERATION_IN_PROGRESS')
    release()
    release()
    const removing = f.kernels.remove(f.manifest.id)
    expect(() => f.kernels.retain(f.manifest.id)).toThrow('OPERATION_IN_PROGRESS')
    await expect(f.kernels.install(f.manifest.id)).rejects.toThrow('OPERATION_IN_PROGRESS')
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('OPERATION_IN_PROGRESS')
    await removing
  })
  it('blocks removal and launch while an installer owns the same kernel', async () => {
    const f = fixture()
    rmSync(f.installPath, { recursive: true })
    vi.mocked(installBrowserPackage).mockImplementationOnce(
      (_manifest, _root, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true })
        }),
    )
    const installing = f.kernels.install(f.manifest.id)
    const cancelled = expect(installing).rejects.toThrow('CANCELLED')
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('OPERATION_IN_PROGRESS')
    expect(() => f.kernels.retain(f.manifest.id)).toThrow('OPERATION_IN_PROGRESS')
    f.kernels.cancelInstall(f.manifest.id)
    await cancelled
    await expect(f.kernels.remove(f.manifest.id)).resolves.toBe(true)
  })
  it('retains a deleted legacy version without allowing unreviewed redownload after restart', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const f = fixture('142.0.7444.175')
    f.environment()
    await f.kernels.remove(f.manifest.id)
    const restarted = createKernelService(f.repository, 'win32', 'x64', f.kernelRoot)
    expect(restarted.registry.get(f.manifest.id).getManifest().version).toBe('142.0.7444.175')
    const catalog = await restarted.catalog()
    expect(catalog.releases.find((item) => item.id === f.manifest.id)).toMatchObject({
      retained: true,
      installed: false,
      installable: false,
      reason: 'RELEASE_UNREVIEWED',
    })
  })
  it('keeps disabled, retryable metadata if DB cleanup fails after file deletion, including restart', async () => {
    const f = fixture()
    vi.spyOn(f.repository, 'deleteKernelInstallation').mockImplementationOnce(() => {
      throw new Error('db failure')
    })
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('KERNEL_REMOVE_FAILED')
    const restarted = createKernelService(f.repository, 'win32', 'x64', f.kernelRoot)
    expect(restarted.list().find((k) => k.id === f.manifest.id)).toMatchObject({
      removalPending: true,
      status: 'removal-pending',
    })
    expect(restarted.executableFor({ kernelId: f.manifest.id })).toBeUndefined()
    expect(() => restarted.retain(f.manifest.id)).toThrow('KERNEL_REMOVAL_PENDING')
    await expect(restarted.install(f.manifest.id)).rejects.toThrow('KERNEL_REMOVAL_PENDING')
    await expect(restarted.remove(f.manifest.id)).resolves.toBe(true)
    expect(f.repository.listKernelInstallations()).toEqual([])
  })
  it('keeps partial file deletion disabled and retryable after a filesystem failure', async () => {
    const f = fixture()
    vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }))
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('KERNEL_REMOVE_FAILED')
    expect(existsSync(f.installPath)).toBe(true)
    expect(f.kernels.executableFor({ kernelId: f.manifest.id })).toBeUndefined()
    await expect(f.kernels.remove(f.manifest.id)).resolves.toBe(true)
  })
  it('never deletes files if marking the durable removal intent fails', async () => {
    const f = fixture()
    vi.spyOn(f.repository, 'markKernelRemoving').mockImplementationOnce(() => {
      throw new Error('db failure')
    })
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow()
    expect(existsSync(f.installPath)).toBe(true)
    expect(f.repository.listKernelInstallations()[0].state).toBe('installed')
  })
  it.each(['outside', 'root', 'wrong-identity'])(
    'rejects a tampered %s install path',
    async (kind) => {
      const f = fixture()
      const installation = {
        kernelId: f.installation.kernelId,
        version: f.installation.version,
        platform: f.installation.platform,
        arch: f.installation.arch,
        sourceUrl: f.installation.sourceUrl,
        sha256: f.installation.sha256,
        state: f.installation.state,
      }
      f.repository.recordKernelInstallation({
        ...installation,
        installPath:
          kind === 'outside'
            ? f.root
            : kind === 'root'
              ? f.kernelRoot
              : join(f.kernelRoot, 'another', f.manifest.version, `win32-x64-${randomUUID()}`),
      })
      await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('KERNEL_PATH_UNSAFE')
      expect(existsSync(f.installPath)).toBe(true)
    },
  )
  it('rejects directory symlinks/junctions before mutating metadata', async () => {
    const f = fixture()
    const outside = join(f.root, 'external')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep'), 'preserve')
    rmSync(f.installPath, { recursive: true })
    symlinkSync(outside, f.installPath, 'junction')
    await expect(f.kernels.remove(f.manifest.id)).rejects.toThrow('KERNEL_PATH_UNSAFE')
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('preserve')
    expect(f.repository.listKernelInstallations()[0].state).toBe('installed')
  })
})
