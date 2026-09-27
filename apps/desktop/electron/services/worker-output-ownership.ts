import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  type BigIntStats,
} from 'node:fs'
import { dirname, join } from 'node:path'

type Identity = Pick<BigIntStats, 'dev' | 'ino' | 'birthtimeNs'>
const sameIdentity = (one: Identity, two: Identity) =>
  one.dev === two.dev && one.ino === two.ino && one.birthtimeNs === two.birthtimeNs

/** Path checks fail closed on replacement. These portable APIs are not atomic unlinkat. */
export function ownWorkerOutputDirectory(root: string, rootIdentity: Identity, directory: string) {
  if (dirname(directory) !== root) throw new Error('WORKER_OUTPUT_INVALID')
  const directoryIdentity = lstatSync(directory, { bigint: true })
  const screenshotPath = join(directory, 'screenshot.png')
  let removed = false
  const verifyDirectory = (path: string, expected: Identity) => {
    const current = lstatSync(path, { bigint: true })
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !sameIdentity(current, expected) ||
      realpathSync(path) !== path
    )
      throw new Error('WORKER_OUTPUT_INVALID')
  }
  const verifyParents = () => {
    try {
      verifyDirectory(root, rootIdentity)
      verifyDirectory(directory, directoryIdentity)
    } catch {
      throw new Error('WORKER_OUTPUT_INVALID')
    }
  }
  verifyParents()
  return {
    verifyParents,
    snapshot() {
      verifyParents()
      return { root: outputIdentity(rootIdentity), directory: outputIdentity(directoryIdentity) }
    },
    discard(fileIdentity?: Identity) {
      if (removed) return
      try {
        verifyParents()
        const entries = readdirSync(directory)
        if (entries.some((entry) => entry !== 'screenshot.png'))
          throw new Error('WORKER_OUTPUT_CLEANUP_FAILED')
        if (entries.length) {
          const before = lstatSync(screenshotPath, { bigint: true })
          if (!fileIdentity || !before.isFile() || before.isSymbolicLink())
            throw new Error('WORKER_OUTPUT_CLEANUP_FAILED')
          const descriptor = openSync(screenshotPath, 'r')
          try {
            // Windows path stat dev differs from handle stat dev; compare handles to handles.
            const current = fstatSync(descriptor, { bigint: true })
            if (!current.isFile() || current.nlink !== 1n || !sameIdentity(current, fileIdentity))
              throw new Error('WORKER_OUTPUT_CLEANUP_FAILED')
          } finally {
            closeSync(descriptor)
          }
          verifyParents()
          const after = lstatSync(screenshotPath, { bigint: true })
          if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(before, after))
            throw new Error('WORKER_OUTPUT_CLEANUP_FAILED')
          unlinkSync(screenshotPath)
        }
        verifyParents()
        // Only remove this proven, empty allocation. Never recursively remove extra entries.
        rmdirSync(directory)
        removed = true
      } catch {
        // Uncertainty preserves remaining data; no raw path or filesystem message crosses IPC.
        throw new Error('WORKER_OUTPUT_CLEANUP_FAILED')
      }
    },
  }
}

export function outputIdentity(info: Identity) {
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  }
}
