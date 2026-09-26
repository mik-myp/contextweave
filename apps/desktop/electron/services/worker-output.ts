import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  write,
} from 'node:fs'
import { join } from 'node:path'
import {
  maxWorkerScreenshotBytes,
  maxWorkerScreenshotChunkBytes,
} from '@contextweave/worker-protocol'

export type WorkerOutputWriter = (
  descriptor: number,
  data: Uint8Array,
  offset: number,
) => Promise<number>
const writeChunk: WorkerOutputWriter = (descriptor, data, offset) =>
  new Promise((resolve, reject) => {
    write(descriptor, data, offset, data.byteLength - offset, null, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** The descriptor never leaves Main. No caller ID or filename participates in allocation. */
export function createWorkerOutput(root: string, writer: WorkerOutputWriter = writeChunk) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootInfo = lstatSync(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('WORKER_OUTPUT_UNAVAILABLE')
  const canonicalRoot = realpathSync(root)
  const directory = mkdtempSync(join(canonicalRoot, 'run-'))
  const screenshotPath = join(directory, 'screenshot.png')
  let descriptor: number | undefined
  try {
    descriptor = openSync(screenshotPath, 'wx', 0o600)
    const identity = fstatSync(descriptor, { bigint: true })
    let pending: Promise<void> | undefined
    let closing = false
    let failed = false
    let size = 0
    const close = async () => {
      closing = true
      // Never close/reuse a descriptor while libuv may still be writing to it.
      await pending?.catch(() => {})
      if (descriptor !== undefined) {
        closeSync(descriptor)
        descriptor = undefined
      }
    }
    return {
      directory,
      screenshotPath,
      append(data: Uint8Array): Promise<void> {
        if (
          closing ||
          failed ||
          pending ||
          descriptor === undefined ||
          data.byteLength === 0 ||
          data.byteLength > maxWorkerScreenshotChunkBytes ||
          size + data.byteLength > maxWorkerScreenshotBytes
        )
          return Promise.reject(new Error('WORKER_OUTPUT_INVALID'))
        const fd = descriptor
        // Reserve the slot synchronously; even re-entrant delivery cannot schedule a second write.
        const copy = new Uint8Array(data)
        pending = Promise.resolve()
          .then(async () => {
            let offset = 0
            while (offset < copy.byteLength) {
              const bytes = await writer(fd, copy, offset)
              if (!Number.isInteger(bytes) || bytes <= 0 || bytes > copy.byteLength - offset)
                throw new Error('WORKER_OUTPUT_INVALID')
              offset += bytes
            }
            size += copy.byteLength
          })
          .catch(() => {
            failed = true
            throw new Error('WORKER_OUTPUT_FAILED')
          })
          .finally(() => {
            pending = undefined
          })
        return pending
      },
      close,
      validate() {
        if (!closing || descriptor !== undefined || pending || failed)
          throw new Error('WORKER_OUTPUT_INVALID')
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
          // Compare 64-bit handle identities on both sides (Windows path dev differs from fstat).
          const current = fstatSync(verificationDescriptor, { bigint: true })
          const header = Buffer.alloc(pngSignature.length)
          if (
            !current.isFile() ||
            current.nlink !== 1n ||
            current.dev !== identity.dev ||
            current.ino !== identity.ino ||
            current.size !== BigInt(size) ||
            current.size < BigInt(header.length) ||
            current.size > BigInt(maxWorkerScreenshotBytes) ||
            readSync(verificationDescriptor, header, 0, header.length, 0) !== header.length ||
            !header.equals(pngSignature)
          )
            throw new Error('WORKER_OUTPUT_INVALID')
          return screenshotPath
        } finally {
          closeSync(verificationDescriptor)
        }
      },
      async discard() {
        await close()
        rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
