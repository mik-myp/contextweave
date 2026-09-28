import { createWriteStream } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, readlink, realpath, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { withKernelDmg } from './kernel-dmg'
import { open as openZip, type Entry, type ZipFile } from 'yauzl'
import type { KernelManifest } from '@contextweave/contracts'
import { fingerprintArchiveFormat } from '@contextweave/kernel-fingerprint-chromium'

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
type ZipPathKind = 'directory' | 'file' | 'link'
interface ZipPath {
  name: string
  kind: ZipPathKind
  explicit: boolean
}
interface ZipLink {
  name: string
  target: string
}
const zipPathKey = (name: string) => name.normalize('NFC').toLowerCase()

function registerZipPath(paths: Map<string, ZipPath>, name: string, kind: ZipPathKind): void {
  const parts = name.split('/')
  for (let index = 0; index < parts.length; index++) {
    const prefix = parts.slice(0, index + 1).join('/')
    const key = zipPathKey(prefix)
    const existing = paths.get(key)
    const explicit = index === parts.length - 1
    const type = explicit ? kind : 'directory'
    // Track implicit parents too: a link/file cannot become a directory, in either order.
    if (
      existing &&
      (existing.name !== prefix ||
        existing.kind !== 'directory' ||
        type !== 'directory' ||
        (explicit && existing.explicit))
    )
      throw new Error('ARCHIVE_UNSAFE')
    paths.set(key, { name: prefix, kind: type, explicit: explicit || !!existing?.explicit })
    if (paths.size > 50000) throw new Error('ARCHIVE_UNSAFE')
  }
}

async function readZipLink(source: import('node:stream').Readable, signal: AbortSignal) {
  const chunks: Buffer[] = []
  let size = 0
  await pipeline(
    source,
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > 4096) callback(new Error('ARCHIVE_UNSAFE'))
        else {
          chunks.push(chunk)
          callback()
        }
      },
    }),
    { signal },
  )
  let target: string
  try {
    target = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks),
    )
  } catch {
    throw new Error('ARCHIVE_UNSAFE')
  }
  if (
    !target ||
    isAbsolute(target) ||
    target.includes('\\') ||
    target.includes(':') ||
    [...target].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    target.split('/').some((part) => !part)
  )
    throw new Error('ARCHIVE_UNSAFE')
  return target
}

export async function extractZip(archive: string, destination: string, signal: AbortSignal) {
  await extractZipContents(archive, destination, signal, false)
}

async function extractZipContents(
  archive: string,
  destination: string,
  signal: AbortSignal,
  macPackage: boolean,
) {
  const paths = new Map<string, ZipPath>()
  const links: ZipLink[] = []
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
        if (
          Buffer.byteLength(entry.fileName) > 4096 ||
          entry.fileName.split('/').some((part) => Buffer.byteLength(part) > 255)
        )
          throw new Error('ARCHIVE_UNSAFE')
        const target = safeArchivePath(destination, entry.fileName)
        const fileType = (entry.externalFileAttributes >>> 16) & 0xf000
        const isLink = fileType === 0xa000
        const isDirectory = entry.fileName.endsWith('/')
        size += entry.uncompressedSize
        if (
          ++count > 50000 ||
          size > 1_500_000_000 ||
          entry.uncompressedSize > 800_000_000 ||
          (fileType !== 0 &&
            fileType !== 0x8000 &&
            fileType !== 0x4000 &&
            !(macPackage && isLink)) ||
          (fileType === 0x4000 && !isDirectory) ||
          (isDirectory &&
            (entry.uncompressedSize !== 0 || (fileType !== 0 && fileType !== 0x4000))) ||
          (isLink && entry.uncompressedSize > 4096)
        )
          throw new Error('ARCHIVE_UNSAFE')
        const name = entry.fileName.replace(/\/$/, '')
        registerZipPath(paths, name, isDirectory ? 'directory' : isLink ? 'link' : 'file')
        if (isDirectory)
          await mkdir(target, { recursive: true, ...(macPackage ? { mode: 0o700 } : {}) })
        else {
          await mkdir(dirname(target), { recursive: true, ...(macPackage ? { mode: 0o700 } : {}) })
          const source = await new Promise<import('node:stream').Readable>(
            (resolveStream, rejectStream) =>
              zip.openReadStream(entry, (error, stream) =>
                error || !stream
                  ? rejectStream(error ?? new Error('ARCHIVE_INVALID'))
                  : resolveStream(stream),
              ),
          )
          if (isLink) links.push({ name, target: await readZipLink(source, signal) })
          else {
            // Preserve only owner execution, never group/other permissions or set-id bits.
            const mode = 0o600 | (macPackage ? (entry.externalFileAttributes >>> 16) & 0o100 : 0)
            await pipeline(source, createWriteStream(target, { flags: 'wx', mode }), { signal })
          }
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
    else if (zip.entryCount > 50000) finish(new Error('ARCHIVE_UNSAFE'))
    else zip.readEntry()
  })
  return { paths, links }
}

function macPackageRoot(paths: Map<string, ZipPath>): { root: string; bundle: string } {
  const bundles = [...paths.values()].filter(
    (entry) => entry.kind === 'directory' && entry.name.split('/').at(-1) === 'Chromium.app',
  )
  if (bundles.length !== 1) throw new Error('ARCHIVE_INVALID')
  const bundle = bundles[0].name
  const parts = bundle.split('/')
  if (parts.length > 2) throw new Error('ARCHIVE_INVALID')
  const root = parts.slice(0, -1).join('/')
  // A wrapper must own ALL entries: never discard sibling licenses, resources or another root.
  if (
    root &&
    [...paths.values()].some((entry) => entry.name !== root && !entry.name.startsWith(root + '/'))
  )
    throw new Error('ARCHIVE_INVALID')
  return { root, bundle }
}

function assertZipLinks(
  paths: Map<string, ZipPath>,
  links: ZipLink[],
  root: string,
  bundle: string,
  signal: AbortSignal,
): void {
  const targets = new Map(links.map((link) => [link.name, link.target]))
  for (const link of links) {
    signal.throwIfAborted()
    const boundary = link.name.startsWith(bundle + '/') ? bundle : root
    const depth = boundary ? boundary.split('/').length : 0
    const resolved = link.name.split('/').slice(0, -1)
    let pending = link.target.split('/')
    let hops = 0
    while (pending.length) {
      const part = pending.shift()!
      if (part === '.') continue
      if (part === '..') {
        if (resolved.length <= depth) throw new Error('ARCHIVE_UNSAFE')
        resolved.pop()
        continue
      }
      resolved.push(part)
      const name = resolved.join('/')
      const entry = paths.get(zipPathKey(name))
      if (!entry || entry.name !== name) throw new Error('ARCHIVE_UNSAFE')
      if (entry.kind === 'link') {
        const target = targets.get(name)
        // Bound chains (including cycles) before any symlink is materialized.
        if (!target || ++hops > 40) throw new Error('ARCHIVE_UNSAFE')
        resolved.pop()
        pending = [...target.split('/'), ...pending]
      } else if (pending.length && entry.kind !== 'directory') throw new Error('ARCHIVE_UNSAFE')
    }
    const target = resolved.join('/')
    // Directory aliases to their own ancestors also create recursive traversal cycles.
    if (!target || link.name.startsWith(target + '/')) throw new Error('ARCHIVE_UNSAFE')
  }
}

async function extractMacZip(
  archive: string,
  payload: string,
  signal: AbortSignal,
): Promise<string> {
  const { paths, links } = await extractZipContents(archive, payload, signal, true)
  const { root, bundle } = macPackageRoot(paths)
  assertZipLinks(paths, links, root, bundle, signal)
  for (const link of links) {
    signal.throwIfAborted()
    await symlink(link.target, safeArchivePath(payload, link.name))
  }
  signal.throwIfAborted()
  const app = safeArchivePath(payload, bundle)
  if (!(await lstat(app)).isDirectory()) throw new Error('ARCHIVE_INVALID')
  // Check the whole payload AND the app boundary, not just framework links inside the app.
  try {
    await assertBundleLinks(payload, signal)
    await assertBundleLinks(app, signal)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code))
    )
      throw new Error('ARCHIVE_UNSAFE', { cause: error })
    throw error
  }
  signal.throwIfAborted()
  return root ? safeArchivePath(payload, root) : payload
}
export async function assertBundleLinks(
  root: string,
  signal?: AbortSignal,
  fileSystem = { readdir, readlink, realpath, lstat },
): Promise<void> {
  const { readdir, readlink, realpath, lstat } = fileSystem
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
  // Package recognition is not installation admission; the installation service keeps that gate.
  const macZip = manifest.platform === 'darwin' && fingerprintArchiveFormat(manifest) === 'zip'
  await mkdir(payload, macZip ? { mode: 0o700 } : {})
  if (macZip) return extractMacZip(archive, payload, signal)
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
