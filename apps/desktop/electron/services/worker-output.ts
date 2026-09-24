import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { maxWorkerScreenshotBytes } from '@contextweave/worker-protocol'

/** No caller-provided task ID or filename participates in filesystem allocation. */
export function createWorkerOutput(root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootInfo = lstatSync(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('WORKER_OUTPUT_UNAVAILABLE')
  const canonicalRoot = realpathSync(root)
  const directory = mkdtempSync(join(canonicalRoot, 'run-'))
  const screenshotPath = join(directory, 'screenshot.png')
  let descriptor: number | undefined
  try {
    // Exclusive creation refuses pre-existing files and symlinks; the inherited fd pins the inode.
    descriptor = openSync(screenshotPath, 'wx', 0o600)
    const identity = fstatSync(descriptor, { bigint: true })
    return {
      directory,
      screenshotPath,
      descriptor,
      closeDescriptor() {
        if (descriptor === undefined) return
        closeSync(descriptor)
        descriptor = undefined
      },
      validate() {
        const parent = lstatSync(directory)
        const file = lstatSync(screenshotPath)
        if (
          !parent.isDirectory() ||
          parent.isSymbolicLink() ||
          realpathSync(directory) !== directory ||
          !file.isFile() ||
          file.isSymbolicLink()
        )
          throw new Error('WORKER_OUTPUT_INVALID')
        const verificationDescriptor = openSync(screenshotPath, 'r')
        try {
          // Compare handle stats on both sides: Windows path stats can report a different
          // volume ID from fstat. BigInts retain the exact 64-bit file identity.
          const current = fstatSync(verificationDescriptor, { bigint: true })
          if (
            !current.isFile() ||
            current.nlink !== 1n ||
            current.dev !== identity.dev ||
            current.ino !== identity.ino ||
            current.size === 0n ||
            current.size > BigInt(maxWorkerScreenshotBytes)
          )
            throw new Error('WORKER_OUTPUT_INVALID')
          return screenshotPath
        } finally {
          closeSync(verificationDescriptor)
        }
      },
      discard() {
        this.closeDescriptor()
        rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
