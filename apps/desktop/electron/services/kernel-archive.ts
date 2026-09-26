import { createWriteStream } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { withKernelDmg } from './kernel-dmg'
import { open as openZip, type Entry, type ZipFile } from 'yauzl'
import type { KernelManifest } from '@contextweave/contracts'

export function safeArchivePath(root: string, name: string): string {
  const segments = name.replace(/\/$/, '').split('/')
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    segments.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.includes(':') ||
        [...part].some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error('ARCHIVE_UNSAFE')
  const target = resolve(root, ...segments)
  if (!target.startsWith(resolve(root) + sep)) throw new Error('ARCHIVE_UNSAFE')
  return target
}
export async function extractZip(archive: string, destination: string, signal: AbortSignal) {
  const zip = await new Promise<ZipFile>((resolveZip, reject) =>
    openZip(
      archive,
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, value) =>
        error || !value ? reject(error ?? new Error('ARCHIVE_INVALID')) : resolveZip(value),
    ),
  )
  await new Promise<void>((resolveZip, reject) => {
    let size = 0,
      count = 0,
      finished = false,
      processing = false,
      ended = false
    let failure: unknown
    const paths = new Set<string>()
    const finish = (error?: unknown) => {
      if (finished) return
      failure ??= error
      ended = true
      zip.close()
      // Wait for the active writer before the caller removes its staging directory.
      if (processing) return
      finished = true
      signal.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else resolveZip()
    }
    const abort = () => finish(new Error('CANCELLED'))
    signal.addEventListener('abort', abort, { once: true })
    zip.on('error', finish)
    zip.on('end', () => finish())
    zip.on('entry', (entry: Entry) => {
      processing = true
      void (async () => {
        signal.throwIfAborted()
        const target = safeArchivePath(destination, entry.fileName)
        const fileType = (entry.externalFileAttributes >>> 16) & 0xf000
        size += entry.uncompressedSize
        if (
          ++count > 50000 ||
          size > 1_500_000_000 ||
          entry.uncompressedSize > 800_000_000 ||
          (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) ||
          paths.has(target.toLowerCase())
        )
          throw new Error('ARCHIVE_UNSAFE')
        paths.add(target.toLowerCase())
        if (entry.fileName.endsWith('/')) await mkdir(target, { recursive: true })
        else {
          await mkdir(dirname(target), { recursive: true })
          const source = await new Promise<import('node:stream').Readable>(
            (resolveStream, rejectStream) =>
              zip.openReadStream(entry, (error, stream) =>
                error || !stream
                  ? rejectStream(error ?? new Error('ARCHIVE_INVALID'))
                  : resolveStream(stream),
              ),
          )
          await pipeline(source, createWriteStream(target, { flags: 'wx', mode: 0o600 }), {
            signal,
          })
        }
        signal.throwIfAborted()
      })().then(
        () => {
          processing = false
          if (ended) finish()
          else zip.readEntry()
        },
        (error: unknown) => {
          processing = false
          finish(error)
        },
      )
    })
    if (signal.aborted) abort()
    else zip.readEntry()
  })
}
export async function assertBundleLinks(root: string, signal?: AbortSignal): Promise<void> {
  const canonicalRoot = await realpath(root)
  let count = 0,
    size = 0
  async function inspect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted()
      if (++count > 50000) throw new Error('ARCHIVE_UNSAFE')
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = resolve(dirname(path), await readlink(path))
        const rel = relative(root, target)
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('ARCHIVE_UNSAFE')
        // Resolve the entire chain: an intermediate symlink can change what '..' means.
        const resolved = relative(canonicalRoot, await realpath(path))
        if (resolved.startsWith('..') || isAbsolute(resolved)) throw new Error('ARCHIVE_UNSAFE')
      } else if (entry.isDirectory()) await inspect(path)
      else if (entry.isFile()) {
        const stat = await lstat(path)
        size += stat.size
        if (stat.size > 800_000_000 || size > 1_500_000_000) throw new Error('ARCHIVE_UNSAFE')
      } else throw new Error('ARCHIVE_UNSAFE')
    }
  }
  await inspect(root)
}
export async function extractBrowserArchive(
  archive: string,
  stage: string,
  manifest: KernelManifest,
  signal: AbortSignal,
): Promise<string> {
  const payload = join(stage, 'payload')
  await mkdir(payload)
  if (manifest.platform === 'darwin') {
    await withKernelDmg(archive, stage, signal, async (mount) => {
      const app = join(mount, 'Chromium.app')
      if (!(await lstat(app)).isDirectory()) throw new Error('ARCHIVE_INVALID')
      await assertBundleLinks(app, signal)
      signal.throwIfAborted()
      await cp(app, join(payload, 'Chromium.app'), {
        recursive: true,
        verbatimSymlinks: true,
        force: false,
        errorOnExist: true,
      })
    })
  } else if (manifest.platform === 'win32') {
    await extractZip(archive, payload, signal)
    // Official portable ZIPs may contain one wrapping directory.
    const entries = await readdir(payload, { withFileTypes: true })
    if (!entries.some((entry) => entry.name.toLowerCase() === 'chrome.exe')) {
      if (entries.length !== 1 || !entries[0].isDirectory()) throw new Error('ARCHIVE_INVALID')
      return join(payload, entries[0].name)
    }
  } else throw new Error('PLATFORM_UNSUPPORTED')
  signal.throwIfAborted()
  return payload
}
export async function verifyBrowserExecutable(path: string, manifest: KernelManifest) {
  if (!(await lstat(path)).isFile()) throw new Error('EXECUTABLE_INVALID')
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(4096)
    await file.read(header, 0, header.length, 0)
    if (manifest.platform === 'darwin') {
      const cpu = manifest.arch === 'arm64' ? 0x0100000c : 0x01000007
      if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== cpu)
        throw new Error('ARCHITECTURE_MISMATCH')
    } else {
      const offset = header.readUInt32LE(0x3c)
      if (
        header.toString('ascii', 0, 2) !== 'MZ' ||
        offset > header.length - 6 ||
        header.readUInt32LE(offset) !== 0x00004550 ||
        header.readUInt16LE(offset + 4) !== 0x8664
      )
        throw new Error('ARCHITECTURE_MISMATCH')
    }
  } finally {
    await file.close()
  }
}
