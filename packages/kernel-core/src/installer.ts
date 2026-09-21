import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KernelManifest } from '@contextweave/contracts'

export type KernelDownload = (url: string, signal?: AbortSignal) => Promise<Uint8Array>

export type KernelInstallResult = {
  kernelId: string
  version: string
  installPath: string
  executablePath: string
  sha256: string
  sizeBytes: number
}

function assertSafeExecutableName(executable: string): void {
  if (
    executable.length === 0
    || executable === '.'
    || executable === '..'
    || executable.includes('/')
    || executable.includes('\\')
    || executable.includes('..')
  ) {
    throw new Error('Kernel executable must be a safe file name')
  }
}

async function downloadFromHttps(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Kernel download failed with HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function installKernelPackage(
  manifest: KernelManifest,
  rootDir: string,
  options: { signal?: AbortSignal; download?: KernelDownload } = {},
): Promise<KernelInstallResult> {
  const packageInfo = manifest.package
  if (!packageInfo?.url || !packageInfo.sha256) {
    throw new Error(`Kernel ${manifest.id} does not have a verified package manifest`)
  }
  const packageUrl = new URL(packageInfo.url)
  if (packageUrl.protocol !== 'https:') {
    throw new Error('Kernel packages must be downloaded over HTTPS')
  }
  assertSafeExecutableName(manifest.executable)

  const download = options.download ?? downloadFromHttps
  const bytes = await download(packageInfo.url, options.signal)
  if (packageInfo.sizeBytes !== undefined && bytes.byteLength !== packageInfo.sizeBytes) {
    throw new Error(`Kernel package size mismatch: expected ${packageInfo.sizeBytes}, received ${bytes.byteLength}`)
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256.toLowerCase() !== packageInfo.sha256.toLowerCase()) {
    throw new Error(`Kernel package SHA-256 mismatch: expected ${packageInfo.sha256}, received ${sha256}`)
  }

  const installPath = join(rootDir, manifest.id, manifest.version, `${manifest.platform}-${manifest.arch}`)
  const executablePath = join(installPath, manifest.executable)
  mkdirSync(installPath, { recursive: true })
  const temporaryPath = join(installPath, `.download-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, bytes)
    renameSync(temporaryPath, executablePath)
    if (manifest.platform !== 'win32') chmodSync(executablePath, 0o755)
  } finally {
    rmSync(temporaryPath, { force: true })
  }

  return {
    kernelId: manifest.id,
    version: manifest.version,
    installPath,
    executablePath,
    sha256,
    sizeBytes: bytes.byteLength,
  }
}
