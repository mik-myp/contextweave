import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  write,
  type BigIntStats,
} from 'node:fs'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ownWorkerOutputDirectory, outputIdentity } from './worker-output-ownership'
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
  const rootInfo = lstatSync(root, { bigint: true })
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('WORKER_OUTPUT_UNAVAILABLE')
  const canonicalRoot = realpathSync(root)
  const directory = mkdtempSync(join(canonicalRoot, 'run-'))
  const ownership = ownWorkerOutputDirectory(canonicalRoot, rootInfo, directory)
  const screenshotPath = join(directory, 'screenshot.png')
  let identity: BigIntStats | undefined
  let descriptor: number | undefined
  try {
    ownership.verifyParents()
    descriptor = openSync(screenshotPath, 'wx', 0o600)
    identity = fstatSync(descriptor, { bigint: true })
    const fileIdentity = identity
    ownership.verifyParents()
    let pending: Promise<void> | undefined
    let closing = false
    let failed = false
    let size = 0
    const writtenHash = createHash('sha256')
    const artifactId = randomUUID()
    const close = async () => {
      closing = true
      // Never close/reuse a descriptor while libuv may still be writing to it.
      await pending?.catch(() => {})
      if (descriptor !== undefined) {
        closeSync(descriptor)
        descriptor = undefined
      }
    }
    const inspect = () => {
      if (!closing || descriptor !== undefined || pending || failed)
        throw new Error('WORKER_OUTPUT_INVALID')
      ownership.verifyParents()
      const parent = lstatSync(directory)
      const file = lstatSync(screenshotPath, { bigint: true })
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        realpathSync(directory) !== directory ||
        readdirSync(directory).some((name) => name !== 'screenshot.png') ||
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
          current.dev !== fileIdentity.dev ||
          current.ino !== fileIdentity.ino ||
          current.birthtimeNs !== fileIdentity.birthtimeNs ||
          current.size !== BigInt(size) ||
          current.size < BigInt(header.length) ||
          current.size > BigInt(maxWorkerScreenshotBytes) ||
          readSync(verificationDescriptor, header, 0, header.length, 0) !== header.length ||
          !header.equals(pngSignature)
        )
          throw new Error('WORKER_OUTPUT_INVALID')
        const hash = createHash('sha256')
        const block = Buffer.alloc(maxWorkerScreenshotChunkBytes)
        for (let offset = 0; offset < size;) {
          const bytes = readSync(
            verificationDescriptor,
            block,
            0,
            Math.min(block.length, size - offset),
            offset,
          )
          if (bytes <= 0) throw new Error('WORKER_OUTPUT_INVALID')
          hash.update(block.subarray(0, bytes))
          offset += bytes
        }
        const sha256 = hash.digest('hex')
        const after = fstatSync(verificationDescriptor, { bigint: true })
        const pathAfter = lstatSync(screenshotPath, { bigint: true })
        ownership.verifyParents()
        if (
          sha256 !== writtenHash.copy().digest('hex') ||
          after.size !== current.size ||
          after.mtimeNs !== current.mtimeNs ||
          after.ctimeNs !== current.ctimeNs ||
          after.nlink !== 1n ||
          !pathAfter.isFile() ||
          pathAfter.isSymbolicLink() ||
          pathAfter.dev !== file.dev ||
          pathAfter.ino !== file.ino ||
          pathAfter.birthtimeNs !== file.birthtimeNs
        )
          throw new Error('WORKER_OUTPUT_INVALID')
        return {
          artifactId,
          allocationName: basename(directory),
          bytes: size,
          sha256,
          ownership: {
            version: 1 as const,
            ...ownership.snapshot(),
            file: outputIdentity(current),
          },
        }
      } finally {
        closeSync(verificationDescriptor)
      }
    }
    return {
      artifactId,
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
            writtenHash.update(copy)
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
      inspect,
      validate: () => {
        inspect()
        return screenshotPath
      },
      async discard() {
        await close()
        ownership.discard(fileIdentity)
      },
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    ownership.discard(identity)
    throw error
  }
}
