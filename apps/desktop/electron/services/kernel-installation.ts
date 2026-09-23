import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { KernelManifest, KernelSummary } from '@contextweave/contracts'
import { fingerprintChromiumLicense } from '@contextweave/kernel-fingerprint-chromium'
import { extractBrowserArchive, verifyBrowserExecutable } from './kernel-archive'

export type InstallProgress = NonNullable<KernelSummary['installation']>
const downloadHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
])
export async function fetchKernelArchive(
  url: string,
  signal: AbortSignal,
  redirects = 0,
  allowCustomSource = false,
): Promise<Response> {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (!allowCustomSource && (parsed.port || !downloadHosts.has(parsed.hostname))) ||
    redirects > 5
  )
    throw new Error('DOWNLOAD_SOURCE_INVALID')
  const response = await fetch(url, { signal, redirect: 'manual' })
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location) throw new Error('DOWNLOAD_FAILED')
    return fetchKernelArchive(new URL(location, url).href, signal, redirects + 1, allowCustomSource)
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('DOWNLOAD_FAILED')
  }
  return response
}
export async function downloadVerifiedArchive(
  manifest: KernelManifest,
  path: string,
  signal: AbortSignal,
  progress: (received: number, total?: number) => void,
  download = fetchKernelArchive,
) {
  const info = manifest.package
  if (!info?.url || !info.sha256) throw new Error('PROVIDER_UNVERIFIED')
  const response = await download(info.url, signal, 0, manifest.sourceType === 'custom')
  if (!response.body) throw new Error('DOWNLOAD_FAILED')
  const headerSize = Number(response.headers.get('content-length'))
  const maximumBytes = 800_000_000
  const total =
    info.sizeBytes ?? (Number.isSafeInteger(headerSize) && headerSize > 0 ? headerSize : undefined)
  if (total && total > maximumBytes) {
    await response.body.cancel()
    throw new Error('PACKAGE_SIZE_MISMATCH')
  }
  const digest = createHash('sha256')
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > (info.sizeBytes ?? maximumBytes)) {
        callback(new Error('PACKAGE_SIZE_MISMATCH'))
        return
      }
      digest.update(chunk)
      progress(received, total)
      callback(null, chunk)
    },
  })
  const body = response.body
  const chunks = async function* () {
    const reader = body.getReader()
    try {
      for (let item = await reader.read(); !item.done; item = await reader.read()) yield item.value
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
  }
  await pipeline(
    Readable.from(chunks()),
    meter,
    createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    { signal },
  )
  if (info.sizeBytes !== undefined && received !== info.sizeBytes)
    throw new Error('PACKAGE_SIZE_MISMATCH')
  if (digest.digest('hex') !== info.sha256.toLowerCase()) throw new Error('PACKAGE_HASH_MISMATCH')
  return received
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
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
