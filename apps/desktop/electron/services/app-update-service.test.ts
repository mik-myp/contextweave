import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppUpdateService } from './app-update-service'
import { appReleaseRepository } from './app-update-release'
import { downloadVerifiedFile } from './verified-download'
import { createAppUpdateHandlers } from '../app-update-ipc'

const bytes = Buffer.from('a verified installer fixture')
const fileName = 'ContextWeave-0.2.0-mac-arm64.dmg'
const metadata = {
  tag_name: 'v0.2.0',
  draft: false,
  prerelease: false,
  body: 'Changes',
  published_at: '2026-09-24T00:00:00Z',
  assets: [
    {
      name: fileName,
      state: 'uploaded',
      size: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      browser_download_url: `${appReleaseRepository}/releases/download/v0.2.0/${fileName}`,
    },
  ],
}
const roots: string[] = []
async function fixture(overrides: Partial<Parameters<typeof createAppUpdateService>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'contextweave-update-test-'))
  roots.push(root)
  const openPath = vi.fn(async () => '')
  const openExternal = vi.fn(async () => {})
  const fetchRelease = vi.fn(async () => metadata)
  const download: typeof downloadVerifiedFile = (info, path, signal, report) =>
    downloadVerifiedFile(info, path, signal, report, async () => new Response(bytes))
  const service = createAppUpdateService({
    root,
    currentVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    openPath,
    openExternal,
    fetchRelease,
    download,
    hasActiveEnvironments: () => false,
    ...overrides,
  })
  return { root, service, openPath, openExternal, fetchRelease }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('manual application updates', () => {
  it('does nothing until requested, downloads once, verifies bytes and opens only on explicit command', async () => {
    const { service, fetchRelease, openPath, root } = await fixture()
    expect(service.getState().phase).toBe('idle')
    expect(fetchRelease).not.toHaveBeenCalled()
    const check = service.check()
    expect(service.check()).toBe(check)
    expect((await check).phase).toBe('available')
    expect(fetchRelease).toHaveBeenCalledTimes(1)
    const downloading = service.download()
    expect(service.download()).toBe(downloading)
    expect((await downloading).phase).toBe('ready')
    expect(await readdir(root)).toEqual([fileName])
    expect(openPath).not.toHaveBeenCalled()
    expect((await service.openInstaller()).phase).toBe('ready')
    expect(openPath).toHaveBeenCalledWith(join(root, fileName))
  })
  it('does not open while environments are active and allows retry after stopping them', async () => {
    let active = true
    const { service, openPath } = await fixture({ hasActiveEnvironments: () => active })
    await service.check()
    await service.download()
    expect(await service.openInstaller()).toMatchObject({
      phase: 'ready',
      errorCode: 'UPDATE_ENVIRONMENTS_ACTIVE',
    })
    expect(openPath).not.toHaveBeenCalled()
    active = false
    expect(await service.openInstaller()).toMatchObject({ phase: 'ready', errorCode: undefined })
    expect(openPath).toHaveBeenCalledTimes(1)
  })
  it('rejects tampering between download and open, then allows a new verified download', async () => {
    const { service, openPath, root } = await fixture()
    await service.check()
    await service.download()
    await writeFile(join(root, fileName), Buffer.alloc(bytes.length))
    expect(await service.openInstaller()).toMatchObject({
      phase: 'error',
      errorCode: 'PACKAGE_HASH_MISMATCH',
    })
    expect(openPath).not.toHaveBeenCalled()
    expect((await service.download()).phase).toBe('ready')
    await service.openInstaller()
    expect(openPath).toHaveBeenCalledTimes(1)
  })
  it('cancels an in-flight download, removes partial files and keeps the release available for retry', async () => {
    let started!: () => void
    const begun = new Promise<void>((resolve) => {
      started = resolve
    })
    const { service, root, openPath } = await fixture({
      download: async (_info, path, signal, report) => {
        await writeFile(path, 'partial')
        report(7, bytes.length)
        started()
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        return 0
      },
    })
    await service.check()
    const download = service.download()
    await begun
    expect(service.getState()).toMatchObject({ phase: 'downloading', receivedBytes: 7 })
    expect(await service.cancel()).toMatchObject({
      phase: 'cancelled',
      release: { version: '0.2.0' },
    })
    await download
    expect(await readdir(root)).toEqual([])
    expect(openPath).not.toHaveBeenCalled()
  })
  it('cleans failed hash checks and never opens failed downloads', async () => {
    const { service, root, openPath } = await fixture({
      download: (info, path, signal, report) =>
        downloadVerifiedFile(
          info,
          path,
          signal,
          report,
          async () => new Response(Buffer.alloc(bytes.length)),
        ),
    })
    await service.check()
    expect(await service.download()).toMatchObject({
      phase: 'error',
      errorCode: 'PACKAGE_HASH_MISMATCH',
    })
    expect(await readdir(root)).toEqual([])
    await expect(service.openInstaller()).rejects.toThrow('UPDATE_NOT_READY')
    expect(openPath).not.toHaveBeenCalled()
  })
  it('validates IPC payloads and releases and returns recoverable errors', async () => {
    const { service, openExternal } = await fixture()
    const handlers = createAppUpdateHandlers(service)
    expect(
      await handlers['update:download']({ url: 'https://example.com/evil.exe' }),
    ).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(await handlers['update:open-installer'](undefined)).toMatchObject({
      ok: false,
      code: 'UPDATE_NOT_READY',
    })
    expect(await handlers['update:check'](undefined)).toMatchObject({
      ok: true,
      data: { phase: 'available' },
    })
    expect(await handlers['update:open-release'](undefined)).toMatchObject({ ok: true, data: true })
    expect(openExternal).toHaveBeenCalledWith(`${appReleaseRepository}/releases/tag/v0.2.0`)
    await service.shutdown()
    expect(await handlers['update:check'](undefined)).toMatchObject({
      ok: false,
      code: 'APP_CLOSING',
    })
  })
  it('reports missing platform assets and network failures without a false latest-version result', async () => {
    const unsupported = await fixture({ platform: 'win32', arch: 'arm64' })
    expect((await unsupported.service.check()).phase).toBe('unsupported')
    await expect(unsupported.service.download()).rejects.toThrow('UPDATE_NOT_AVAILABLE')
    const offline = await fixture({
      fetchRelease: async () => {
        throw new Error('UPDATE_CHECK_FAILED')
      },
    })
    expect(await offline.service.check()).toMatchObject({
      phase: 'error',
      errorCode: 'UPDATE_CHECK_FAILED',
      release: undefined,
    })
  })
})
