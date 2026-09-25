import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'

const maxPreferencesBytes = 16 * 1024 * 1024
const objectSchema = z.record(z.string(), z.unknown())
class BrowserProfileError extends Error {}

function readPreferences(path: string): Record<string, unknown> {
  const before = (() => {
    try {
      return lstatSync(path, { bigint: true })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  })()
  if (!before) return {}
  if (!before.isFile() || before.isSymbolicLink())
    throw new BrowserProfileError('BROWSER_PROFILE_UNSAFE')
  const fd = openSync(path, 'r')
  let text: string
  try {
    const opened = fstatSync(fd, { bigint: true })
    if (!opened.isFile()) throw new BrowserProfileError('BROWSER_PROFILE_UNSAFE')
    if (opened.size > BigInt(maxPreferencesBytes))
      throw new BrowserProfileError('BROWSER_PREFERENCES_TOO_LARGE')
    const chunks: Buffer[] = []
    const buffer = Buffer.alloc(64 * 1024)
    let size = 0
    for (;;) {
      // Keep the read bounded even if another process grows the file after fstat.
      const length = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, maxPreferencesBytes - size + 1),
        null,
      )
      if (!length) break
      size += length
      if (size > maxPreferencesBytes) throw new BrowserProfileError('BROWSER_PREFERENCES_TOO_LARGE')
      chunks.push(Buffer.from(buffer.subarray(0, length)))
    }
    const after = fstatSync(fd, { bigint: true })
    if (opened.size !== after.size || opened.mtimeNs !== after.mtimeNs)
      throw new BrowserProfileError('BROWSER_PROFILE_IO_FAILED')
    const verificationDescriptor = openSync(path, 'r')
    try {
      // Windows can represent dev differently for path and handle stats. Compare
      // each kind with itself; BigInts preserve full-width file identities.
      const current = fstatSync(verificationDescriptor, { bigint: true })
      const currentPath = lstatSync(path, { bigint: true })
      if (
        !current.isFile() ||
        !currentPath.isFile() ||
        currentPath.isSymbolicLink() ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        currentPath.dev !== before.dev ||
        currentPath.ino !== before.ino
      )
        throw new BrowserProfileError('BROWSER_PROFILE_UNSAFE')
    } finally {
      closeSync(verificationDescriptor)
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    } catch {
      throw new BrowserProfileError('BROWSER_PREFERENCES_INVALID')
    }
  } finally {
    closeSync(fd)
  }
  try {
    return objectSchema.parse(JSON.parse(text))
  } catch {
    throw new BrowserProfileError('BROWSER_PREFERENCES_INVALID')
  }
}

// Called before browser spawn, while the runtime owns this environment's lock.
export function prepareBrowserProfile(dataDir: string, language: string, useProxy = false): void {
  if (language === 'auto') throw new Error('IP_LOCALE_FAILED')
  const profile = join(dataDir, 'Default')
  const path = join(profile, 'Preferences')
  let temporary: string | undefined
  let ownsTemporary = false
  try {
    mkdirSync(profile, { recursive: true })
    const directory = lstatSync(profile)
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new BrowserProfileError('BROWSER_PROFILE_UNSAFE')
    const preferences = readPreferences(path)
    let next: Record<string, unknown>
    try {
      const intl = objectSchema.parse(preferences.intl ?? {})
      if (language === 'system') delete intl.accept_languages
      else intl.accept_languages = [...new Set([language, language.split('-')[0]])].join(',')
      next = {
        ...preferences,
        intl,
        session: { ...objectSchema.parse(preferences.session ?? {}), restore_on_startup: 1 },
        background_mode: {
          ...objectSchema.parse(preferences.background_mode ?? {}),
          enabled: false,
        },
        ...(useProxy
          ? {
              network_prediction_options: 2,
              dns_prefetching: {
                ...objectSchema.parse(preferences.dns_prefetching ?? {}),
                enabled: false,
              },
            }
          : {}),
      }
    } catch {
      throw new BrowserProfileError('BROWSER_PREFERENCES_INVALID')
    }
    const content = JSON.stringify(next)
    if (Buffer.byteLength(content) > maxPreferencesBytes)
      throw new BrowserProfileError('BROWSER_PREFERENCES_TOO_LARGE')
    temporary = `${path}.contextweave-${randomUUID()}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    ownsTemporary = true
    try {
      writeFileSync(fd, content)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
    ownsTemporary = false
  } catch (error) {
    if (error instanceof BrowserProfileError) throw error
    throw new BrowserProfileError('BROWSER_PROFILE_IO_FAILED')
  } finally {
    if (ownsTemporary && temporary) {
      try {
        unlinkSync(temporary)
      } catch {
        // Failure is already reported. A uniquely named residue must never be reused or published.
      }
    }
  }
}
