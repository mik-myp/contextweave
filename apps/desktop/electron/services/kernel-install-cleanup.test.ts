import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFingerprintChromiumManifest } from '@contextweave/kernel-fingerprint-chromium'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import * as dmg from './kernel-dmg'
import * as downloads from './verified-download'
import * as installation from './kernel-installation'
import { createKernelService } from './kernel-service'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  statfs: vi.fn(async () => ({
    type: 0,
    bsize: 4096,
    blocks: 1000000,
    bfree: 1000000,
    bavail: 1000000,
    files: 100000,
    ffree: 100000,
  })),
}))
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function fixture(mode: 'success' | 'partial' | 'cancelled' | 'detach' | 'invalid') {
  const root = await fs.mkdtemp(join(tmpdir(), 'cw-kernel-cleanup-'))
  roots.push(root)
  const controller = new AbortController()
  const bytes = Buffer.from('fake verified DMG')
  const manifest = {
    ...createFingerprintChromiumManifest('darwin', 'arm64'),
    package: {
      url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/fixture/browser.dmg',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    },
  }
  let stage = '',
    mount = ''
  const realDmg = dmg.withKernelDmg
  vi.spyOn(downloads, 'downloadVerifiedFile').mockImplementation(
    async (_info, path, _signal, report) => {
      stage = dirname(path)
      await fs.writeFile(path, bytes)
      report(bytes.length, bytes.length)
      return bytes.length
    },
  )
  const run = vi.fn<NonNullable<Parameters<typeof dmg.withKernelDmg>[4]>>(async (_file, args) => {
    if (args[0] === 'attach') {
      mount = args[args.indexOf('-mountpoint') + 1]
      if (mode === 'invalid') await fs.writeFile(join(mount, 'Chromium.app'), 'not a bundle')
      else {
        const executable = join(mount, manifest.executable)
        await fs.mkdir(dirname(executable), { recursive: true })
        const header = Buffer.alloc(64)
        header.writeUInt32LE(0xfeedfacf, 0)
        header.writeUInt32LE(0x0100000c, 4)
        await fs.writeFile(executable, header)
      }
      if (mode === 'cancelled') {
        controller.abort()
        throw new Error('attach aborted')
      }
      if (mode === 'partial') throw new Error('partially attached')
    } else {
      if (['partial', 'cancelled', 'detach'].includes(mode)) throw new Error('busy')
      // This is simulated mounted content, not a real OS mount.
      await fs.rename(join(mount, 'Chromium.app'), join(root, 'detached-fixture-volume'))
    }
  })
  vi.spyOn(dmg, 'withKernelDmg').mockImplementation((archive, stage, signal, read) =>
    realDmg(archive, stage, signal, read, run),
  )
  await fs.mkdir(join(root, 'previous-install'))
  await fs.writeFile(join(root, 'previous-install', 'sentinel'), 'keep previous installation')
  return { root, manifest, controller, stage: () => stage, mount: () => mount }
}

describe('kernel installation cleanup boundary', () => {
  it.each(['partial', 'cancelled', 'detach'] as const)(
    'retains the backing image and private stage after %s cleanup failure without finalizing an install',
    async (mode) => {
      const f = await fixture(mode)
      await expect(
        installation.installBrowserPackage(f.manifest, f.root, f.controller.signal, vi.fn()),
      ).rejects.toThrow('ARCHIVE_UNMOUNT_FAILED')
      expect(await fs.readFile(join(f.stage(), 'package.download'), 'utf8')).toBe(
        'fake verified DMG',
      )
      expect((await fs.readFile(join(f.mount(), f.manifest.executable))).readUInt32LE(0)).toBe(
        0xfeedfacf,
      )
      expect(await fs.readFile(join(f.root, 'previous-install', 'sentinel'), 'utf8')).toBe(
        'keep previous installation',
      )
      expect(await fs.readdir(f.root)).not.toContain(f.manifest.id)
    },
  )
  it('cleans ordinary invalid content after confirmed detach without touching a previous install', async () => {
    const f = await fixture('invalid')
    await expect(
      installation.installBrowserPackage(f.manifest, f.root, f.controller.signal, vi.fn()),
    ).rejects.toThrow('ARCHIVE_INVALID')
    const entries = await fs.readdir(f.root)
    expect(
      entries.some((entry) => entry.startsWith('.install-') || entry.startsWith('.kernel-mount-')),
    ).toBe(false)
    expect(await fs.readFile(join(f.root, 'previous-install', 'sentinel'), 'utf8')).toBe(
      'keep previous installation',
    )
  })
  it('finalizes a valid payload only after safe unmount and removes its own temporary resources', async () => {
    const f = await fixture('success')
    const result = await installation.installBrowserPackage(
      f.manifest,
      f.root,
      f.controller.signal,
      vi.fn(),
    )
    expect((await fs.readFile(result.executablePath)).readUInt32LE(0)).toBe(0xfeedfacf)
    expect(
      (await fs.readFile(join(result.installPath, 'FINGERPRINT_CHROMIUM_LICENSE.txt'), 'utf8'))
        .length,
    ).toBeGreaterThan(0)
    const entries = await fs.readdir(f.root)
    expect(
      entries.some((entry) => entry.startsWith('.install-') || entry.startsWith('.kernel-mount-')),
    ).toBe(false)
    expect(await fs.readFile(join(f.root, 'previous-install', 'sentinel'), 'utf8')).toBe(
      'keep previous installation',
    )
  })
  it('shows cleanup failure rather than cancellation in kernel service progress', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'cw-kernel-progress-'))
    roots.push(root)
    const db = openLocalDatabase(join(root, 'data.sqlite'))
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline fixture'))
    vi.spyOn(installation, 'installBrowserPackage').mockImplementation(
      (_manifest, _root, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new dmg.KernelDmgCleanupError()), {
            once: true,
          })
        }),
    )
    try {
      const service = createKernelService(
        new EnvironmentRepository(db.sqlite),
        'darwin',
        'arm64',
        root,
      )
      const entry = await service.prepareCustom({
        providerId: 'fingerprint-chromium',
        url: 'https://mirror.example.test/browser.dmg',
        version: '148.0.7778.215',
        sha256: 'b'.repeat(64),
        trustedSource: true,
      })
      const failed = expect(service.install(entry.id)).rejects.toThrow('ARCHIVE_UNMOUNT_FAILED')
      service.cancelInstall(entry.id)
      await failed
      expect(
        (await service.catalog()).releases.find((item) => item.id === entry.id)?.installation,
      ).toMatchObject({
        phase: 'failed',
        errorCode: 'ARCHIVE_UNMOUNT_FAILED',
      })
    } finally {
      db.close()
    }
  })
})
