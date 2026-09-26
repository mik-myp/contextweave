import {
  existsSync,
  fstatSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  maxWorkerScreenshotBytes,
  maxWorkerScreenshotChunkBytes,
} from '@contextweave/worker-protocol'
import { createWorkerOutput, type WorkerOutputWriter } from './worker-output'

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2])
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'cw-worker-output-'))
  roots.push(directory)
  return directory
}

describe('Main-owned worker output', () => {
  it('writes and validates a private file without exposing its descriptor', async () => {
    const output = createWorkerOutput(join(setup(), 'results'))
    expect(output).not.toHaveProperty('descriptor')
    expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
    await output.append(png)
    await output.close()
    expect(output.validate()).toBe(output.screenshotPath)
    expect(readFileSync(output.screenshotPath)).toEqual(Buffer.from(png))
    expect(readdirSync(output.directory)).toEqual(['screenshot.png'])
    await output.discard()
    expect(existsSync(output.directory)).toBe(false)
  })
  it('allocates distinct private directories rather than caller IDs', async () => {
    const root = setup()
    const one = createWorkerOutput(root),
      two = createWorkerOutput(root)
    expect(one.directory).not.toBe(two.directory)
    expect(dirname(one.directory)).toBe(realpathSync(root))
    expect(dirname(two.directory)).toBe(realpathSync(root))
    await one.discard()
    await two.discard()
  })
  it.each(['empty', 'oversized', 'wrong signature', 'different size'])(
    'rejects %s artifacts',
    async (mode) => {
      const output = createWorkerOutput(setup())
      if (mode !== 'empty')
        await output.append(mode === 'wrong signature' ? new Uint8Array(png.length) : png)
      await output.close()
      if (mode === 'oversized') truncateSync(output.screenshotPath, maxWorkerScreenshotBytes + 1)
      if (mode === 'different size') truncateSync(output.screenshotPath, png.length + 1)
      expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
      await output.discard()
    },
  )
  it('does not follow an output-root symlink or junction', () => {
    const root = setup(),
      outside = setup(),
      link = join(root, 'results')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => createWorkerOutput(link)).toThrow('WORKER_OUTPUT_UNAVAILABLE')
    expect(readdirSync(outside)).toEqual([])
  })
  it.each(['hard link', 'regular file'])('rejects a replacement %s', async (replacement) => {
    const root = setup(),
      outside = join(root, 'protected.txt')
    writeFileSync(outside, 'unchanged')
    const output = createWorkerOutput(join(root, 'results'))
    await output.append(png)
    await output.close()
    renameSync(output.screenshotPath, join(output.directory, 'original.png'))
    if (replacement === 'hard link') linkSync(outside, output.screenshotPath)
    else writeFileSync(output.screenshotPath, png)
    expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
    await output.discard()
    expect(readFileSync(outside, 'utf8')).toBe('unchanged')
  })
  it('retains the descriptor during a pending write and rejects a second write before await', async () => {
    let complete!: () => void
    let descriptor = -1
    const writer: WorkerOutputWriter = (fd, bytes, offset) => {
      descriptor = fd
      return new Promise((resolve) => {
        complete = () => resolve(writeSync(fd, bytes, offset, bytes.byteLength - offset))
      })
    }
    const output = createWorkerOutput(setup(), writer)
    const writing = output.append(png)
    await expect(output.append(png)).rejects.toThrow('WORKER_OUTPUT_INVALID')
    await vi.waitFor(() => expect(descriptor).toBeGreaterThanOrEqual(0))
    const closing = output.close()
    expect(fstatSync(descriptor).isFile()).toBe(true)
    await expect(output.append(png)).rejects.toThrow('WORKER_OUTPUT_INVALID')
    complete()
    await writing
    await closing
    expect(() => fstatSync(descriptor)).toThrow()
    expect(output.validate()).toBe(output.screenshotPath)
    await output.close()
    await output.discard()
  })
  it('drains before discarding a cancelled write rather than reusing an active descriptor', async () => {
    let complete!: () => void
    const output = createWorkerOutput(
      setup(),
      (fd, bytes, offset) =>
        new Promise((resolve) => {
          complete = () => resolve(writeSync(fd, bytes, offset, bytes.byteLength - offset))
        }),
    )
    const writing = output.append(png)
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    const discarding = output.discard()
    expect(existsSync(output.screenshotPath)).toBe(true)
    complete()
    await writing
    await discarding
    expect(existsSync(output.directory)).toBe(false)
  })
  it('handles partial filesystem writes without acknowledging truncated output', async () => {
    const output = createWorkerOutput(setup(), async (fd, bytes, offset) =>
      writeSync(fd, bytes, offset, Math.min(3, bytes.byteLength - offset)),
    )
    await output.append(png)
    await output.close()
    expect(readFileSync(output.validate())).toEqual(Buffer.from(png))
    await output.discard()
  })
  it.each(['ENOSPC', 'EACCES', 'zero write'])('sanitizes and cleans %s failures', async (code) => {
    const output = createWorkerOutput(setup(), async () => {
      if (code === 'zero write') return 0
      throw new Error(code + ' secret/path')
    })
    await expect(output.append(png)).rejects.toThrow('WORKER_OUTPUT_FAILED')
    await output.close()
    expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
    await output.discard()
  })
  it('rejects empty and oversized chunks before writing', async () => {
    const output = createWorkerOutput(setup())
    await expect(output.append(new Uint8Array())).rejects.toThrow()
    await expect(output.append(new Uint8Array(maxWorkerScreenshotChunkBytes + 1))).rejects.toThrow()
    expect(readFileSync(output.screenshotPath)).toHaveLength(0)
    await output.discard()
  })
})
