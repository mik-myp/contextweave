import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createFingerprintChromiumManifest } from '@contextweave/kernel-fingerprint-chromium'
import { downloadVerifiedArchive, fetchKernelArchive } from './kernel-installation'
import { assertBundleLinks, safeArchivePath, verifyBrowserExecutable } from './kernel-archive'

describe('managed kernel packages', () => {
  it.skipIf(process.platform === 'win32')(
    'resolves chained bundle symlinks before accepting their containment',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'cw-bundle-links-'))
      try {
        const bundle = join(root, 'browser')
        await mkdir(bundle)
        await mkdir(join(bundle, 'versions'))
        await writeFile(join(bundle, 'versions', 'binary'), 'fixture')
        await symlink('versions', join(bundle, 'current'))
        await assertBundleLinks(bundle)
        await writeFile(join(root, 'outside'), 'fixture')
        await symlink('.', join(bundle, 'inside'))
        await symlink('inside/../outside', join(bundle, 'escape'))
        await expect(assertBundleLinks(bundle)).rejects.toThrow('ARCHIVE_UNSAFE')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it('verifies custom archives without a Content-Length or catalog size', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cw-custom-archive-'))
    const bytes = Buffer.from('custom-package')
    const manifest = {
      ...createFingerprintChromiumManifest('win32', 'x64'),
      sourceType: 'custom' as const,
      package: {
        url: 'https://mirror.test/browser.zip',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    }
    try {
      expect(
        await downloadVerifiedArchive(
          manifest,
          join(root, 'valid'),
          new AbortController().signal,
          () => {},
          async () => new Response(bytes),
        ),
      ).toBe(bytes.length)
      await expect(
        downloadVerifiedArchive(
          manifest,
          join(root, 'invalid'),
          new AbortController().signal,
          () => {},
          async () => new Response('wrong'),
        ),
      ).rejects.toThrow('PACKAGE_HASH_MISMATCH')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('streams an exact package and rejects truncation, overflow, altered bytes and cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cw-install-test-'))
    const bytes = Buffer.from('verified-package-fixture')
    const manifest = {
      ...createFingerprintChromiumManifest('win32', 'x64'),
      package: {
        url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/test/fixture.zip',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
      },
    }
    try {
      const path = join(root, 'ok.zip')
      await downloadVerifiedArchive(
        manifest,
        path,
        new AbortController().signal,
        () => {},
        async () => new Response(bytes),
      )
      expect(await readFile(path)).toEqual(bytes)
      for (const [name, payload, code] of [
        ['truncated', bytes.subarray(1), 'PACKAGE_SIZE_MISMATCH'],
        ['oversized', Buffer.concat([bytes, bytes]), 'PACKAGE_SIZE_MISMATCH'],
        ['altered', Buffer.alloc(bytes.length), 'PACKAGE_HASH_MISMATCH'],
      ] as const) {
        await expect(
          downloadVerifiedArchive(
            manifest,
            join(root, name),
            new AbortController().signal,
            () => {},
            async () => new Response(payload),
          ),
        ).rejects.toThrow(code)
      }
      await expect(
        downloadVerifiedArchive(
          manifest,
          join(root, 'cancelled'),
          AbortSignal.abort(),
          () => {},
          async () => new Response(bytes),
        ),
      ).rejects.toThrow()
      await expect(
        fetchKernelArchive('https://example.com/kernel.zip', new AbortController().signal),
      ).rejects.toThrow('DOWNLOAD_SOURCE_INVALID')
      await expect(
        fetchKernelArchive('http://github.com/kernel.zip', new AbortController().signal),
      ).rejects.toThrow('DOWNLOAD_SOURCE_INVALID')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('rejects archive traversal and platform-specific path tricks', () => {
    for (const value of [
      '../outside',
      '/tmp/outside',
      'C:/outside',
      'a/../../outside',
      'a\\outside',
      'a/CON.txt',
      'a/file:stream',
      'a/../b',
      'a/file.',
      'a//b',
    ])
      expect(() => safeArchivePath(join(tmpdir(), 'cw-extract'), value), value).toThrow(
        'ARCHIVE_UNSAFE',
      )
    expect(safeArchivePath(join(tmpdir(), 'cw-extract'), 'browser/chrome.exe')).toBe(
      join(tmpdir(), 'cw-extract/browser/chrome.exe'),
    )
  })
  it('refuses a macOS binary from the wrong architecture before registering it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cw-architecture-'))
    try {
      const bytes = Buffer.alloc(64)
      bytes.writeUInt32LE(0xfeedfacf, 0)
      bytes.writeUInt32LE(0x0100000c, 4)
      const path = join(root, 'Chromium')
      await writeFile(path, bytes)
      await verifyBrowserExecutable(path, createFingerprintChromiumManifest('darwin', 'arm64'))
      await expect(
        verifyBrowserExecutable(path, createFingerprintChromiumManifest('darwin', 'x64')),
      ).rejects.toThrow('ARCHITECTURE_MISMATCH')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
