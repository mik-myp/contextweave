import { describe, expect, it, vi } from 'vitest'
import { customKernelSourceSchema } from '@contextweave/contracts'
import { createCustomKernelEntry, publicDownloadSource } from './kernel-custom-source'
import { fetchKernelArchive } from './kernel-installation'
import * as installation from './kernel-installation'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createKernelService } from './kernel-service'
import { bundledRelease } from './kernel-catalog'
const input = {
  providerId: 'fingerprint-chromium',
  url: 'https://mirror.example.test/browser.dmg?token=temporary',
  version: '148.0.7778.215',
  sha256: 'b'.repeat(64),
  trustedSource: true,
}
describe('custom kernel source boundary', () => {
  it('recognizes official links and retries the same custom package with a renewed URL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-source-retry-'))
    const db = openLocalDatabase(join(root, 'data.sqlite'))
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline fixture'))
    const installer = vi
      .spyOn(installation, 'installBrowserPackage')
      .mockRejectedValue(new Error('DOWNLOAD_FAILED'))
    try {
      const service = createKernelService(
        new EnvironmentRepository(db.sqlite),
        'darwin',
        'arm64',
        root,
      )
      const official = (await service.catalog()).releases.find((item) => item.installable)!
      const matched = await service.prepareCustom({
        providerId: input.providerId,
        url: bundledRelease('darwin', 'arm64').manifest!.package!.url!,
        trustedSource: false,
      })
      expect(matched.id).toBe(official.id)
      const first = await service.prepareCustom(input)
      await expect(service.install(first.id)).rejects.toThrow('DOWNLOAD_FAILED')
      const renewedUrl = 'https://mirror.example.test/browser.dmg?token=renewed'
      const renewed = await service.prepareCustom({ ...input, url: renewedUrl })
      expect(renewed.id).toBe(first.id)
      await expect(service.install(renewed.id)).rejects.toThrow('DOWNLOAD_FAILED')
      expect(installer.mock.calls[1][0].package?.url).toBe(renewedUrl)
    } finally {
      installer.mockRestore()
      network.mockRestore()
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('requires explicit trust, complete metadata and an existing adapter', () => {
    expect(() =>
      createCustomKernelEntry({ ...input, trustedSource: false }, 'darwin', 'arm64'),
    ).toThrow('CUSTOM_SOURCE_DETAILS_REQUIRED')
    expect(() =>
      createCustomKernelEntry({ ...input, sha256: undefined }, 'darwin', 'arm64'),
    ).toThrow('CUSTOM_SOURCE_DETAILS_REQUIRED')
    expect(() =>
      createCustomKernelEntry({ ...input, providerId: 'unknown' }, 'darwin', 'arm64'),
    ).toThrow('PROVIDER_UNVERIFIED')
    expect(() =>
      createCustomKernelEntry({ ...input, version: '999.0.0.1' }, 'darwin', 'arm64'),
    ).toThrow('ADAPTER_UNSUPPORTED')
    for (const url of [
      'http://mirror.test/core.zip',
      'file:///tmp/core.zip',
      'https://user:password@mirror.test/core.zip',
    ])
      expect(customKernelSourceSchema.safeParse({ ...input, url }).success).toBe(false)
  })
  it('pins custom packages separately and removes temporary URL credentials from persisted source metadata', () => {
    const a = createCustomKernelEntry(input, 'darwin', 'arm64')
    const b = createCustomKernelEntry({ ...input, sha256: 'c'.repeat(64) }, 'darwin', 'arm64')
    expect(a.manifest!.id).not.toBe(b.manifest!.id)
    expect(a.manifest!.id).toContain('custom')
    expect(a.manifest!.package!.url).toBe(input.url)
    expect(JSON.stringify(a.release)).not.toContain('temporary')
    expect(publicDownloadSource(input.url)).toBe('https://mirror.example.test/browser.dmg')
  })
  it('uses the custom source only when authorized, while rejecting an HTTP redirect', async () => {
    const download = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fixture'))
    try {
      await expect(fetchKernelArchive(input.url, new AbortController().signal)).rejects.toThrow(
        'DOWNLOAD_SOURCE_INVALID',
      )
      expect(download).not.toHaveBeenCalled()
      await expect(
        fetchKernelArchive(input.url, new AbortController().signal, 0, true),
      ).resolves.toBeInstanceOf(Response)
      download.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'http://mirror.example.test/core.dmg' },
        }),
      )
      await expect(
        fetchKernelArchive(input.url, new AbortController().signal, 0, true),
      ).rejects.toThrow('DOWNLOAD_SOURCE_INVALID')
    } finally {
      download.mockRestore()
    }
  })
})
