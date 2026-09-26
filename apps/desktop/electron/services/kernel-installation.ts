import { KernelDmgCleanupError } from './kernel-dmg'
import { downloadVerifiedFile, fetchControlledDownload } from './verified-download'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KernelManifest, KernelSummary } from '@contextweave/contracts'
import { fingerprintChromiumLicense } from '@contextweave/kernel-fingerprint-chromium'
import { extractBrowserArchive, verifyBrowserExecutable } from './kernel-archive'

export type InstallProgress = NonNullable<KernelSummary['installation']>
export { fetchControlledDownload as fetchKernelArchive } from './verified-download'
export async function downloadVerifiedArchive(
  manifest: KernelManifest,
  path: string,
  signal: AbortSignal,
  progress: (received: number, total?: number) => void,
  download = fetchControlledDownload,
) {
  const info = manifest.package
  if (!info?.url || !info.sha256) throw new Error('PROVIDER_UNVERIFIED')
  return downloadVerifiedFile(
    { url: info.url, sha256: info.sha256, sizeBytes: info.sizeBytes },
    path,
    signal,
    progress,
    download,
    manifest.sourceType === 'custom',
  )
}
export async function installBrowserPackage(
  manifest: KernelManifest,
  root: string,
  signal: AbortSignal,
  report: (progress: InstallProgress) => void,
) {
  await mkdir(root, { recursive: true })
  const space = await statfs(root)
  if (space.bavail * space.bsize < 2_000_000_000) throw new Error('LOW_DISK')
  const stage = await mkdtemp(join(root, '.install-'))
  let cleanupConfirmed = true
  let totalBytes = manifest.package?.sizeBytes ?? 0
  let receivedBytes = 0,
    lastReport = 0
  try {
    const archive = join(stage, 'package.download')
    report({ phase: 'downloading', totalBytes, receivedBytes })
    await downloadVerifiedArchive(manifest, archive, signal, (value, total) => {
      receivedBytes = value
      totalBytes = total ?? 0
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now()
        report({ phase: 'downloading', receivedBytes, totalBytes })
      }
    })
    report({ phase: 'verifying', totalBytes, receivedBytes })
    signal.throwIfAborted()
    report({ phase: 'extracting', totalBytes, receivedBytes })
    const payload = await extractBrowserArchive(archive, stage, manifest, signal)
    await verifyBrowserExecutable(join(payload, manifest.executable), manifest)
    await writeFile(join(payload, 'FINGERPRINT_CHROMIUM_LICENSE.txt'), fingerprintChromiumLicense, {
      mode: 0o600,
    })
    signal.throwIfAborted()
    const parent = join(root, manifest.id, manifest.version)
    await mkdir(parent, { recursive: true })
    // Unique immutable directory: an interrupted registration cannot replace a working install.
    const installPath = join(parent, `${manifest.platform}-${manifest.arch}-${randomUUID()}`)
    await rename(payload, installPath)
    return {
      installPath,
      executablePath: join(installPath, manifest.executable),
      sizeBytes: receivedBytes,
    }
  } catch (error) {
    if (error instanceof KernelDmgCleanupError) cleanupConfirmed = false
    throw error
  } finally {
    // Keep the backing image as well as the separate mount on uncertain detach.
    if (cleanupConfirmed) await rm(stage, { recursive: true, force: true })
  }
}
