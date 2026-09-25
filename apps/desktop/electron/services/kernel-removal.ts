import { lstat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { KernelInstallationRecord } from '@contextweave/storage'

/** Accept only the immutable payload directories created by our installer. */
export async function validateKernelRemovalPath(
  root: string,
  record: KernelInstallationRecord,
): Promise<string> {
  const { kernelId, version, platform, arch, installPath } = record
  const segment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
  if (![kernelId, version].every((value) => segment.test(value) && value !== '.' && value !== '..'))
    throw new Error('KERNEL_PATH_UNSAFE')
  const rootPath = resolve(root)
  const parent = join(rootPath, kernelId, version)
  const path = resolve(installPath)
  const leaf = basename(path)
  const prefix = `${platform}-${arch}-`
  if (
    dirname(path) !== parent ||
    !leaf.startsWith(prefix) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      leaf.slice(prefix.length),
    )
  )
    throw new Error('KERNEL_PATH_UNSAFE')
  for (const part of [rootPath, join(rootPath, kernelId), parent, path]) {
    try {
      const stat = await lstat(part)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('KERNEL_PATH_UNSAFE')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break // Already deleted: retry DB cleanup.
      throw error
    }
  }
  return path
}
