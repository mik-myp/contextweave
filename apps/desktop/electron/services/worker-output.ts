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
    const identity = fstatSync(descriptor)
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
          file.isSymbolicLink() ||
          file.nlink !== 1 ||
          file.dev !== identity.dev ||
          file.ino !== identity.ino ||
          file.size === 0 ||
          file.size > maxWorkerScreenshotBytes
        )
          throw new Error('WORKER_OUTPUT_INVALID')
        return screenshotPath
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
