import {
  closeSync,
  existsSync,
  ftruncateSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { maxWorkerScreenshotBytes, workerScreenshotDescriptor } from '@contextweave/worker-protocol'
import { createWorkerOutput } from './worker-output'

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
  it('writes through an inherited descriptor in a real subprocess and validates the allocated file', () => {
    const root = setup()
    const output = createWorkerOutput(join(root, 'results'))
    try {
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `require('node:fs').writeFileSync(${workerScreenshotDescriptor}, Buffer.from('test screenshot'))`,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe', output.descriptor],
        },
      )
      expect(child.status, child.stderr?.toString()).toBe(0)
      expect(output.validate()).toBe(output.screenshotPath)
      expect(readFileSync(output.screenshotPath, 'utf8')).toBe('test screenshot')
      expect(readdirSync(output.directory)).toEqual(['screenshot.png'])
    } finally {
      output.discard()
    }
    expect(existsSync(output.directory)).toBe(false)
  })

  it('allocates distinct private directories rather than using caller IDs or reusing filenames', () => {
    const root = setup()
    const one = createWorkerOutput(root)
    const two = createWorkerOutput(root)
    try {
      expect(one.directory).not.toBe(two.directory)
      expect(dirname(one.directory)).toBe(realpathSync(root))
      expect(dirname(two.directory)).toBe(realpathSync(root))
    } finally {
      one.discard()
      two.discard()
    }
  })

  it('rejects empty or oversized artifacts', () => {
    const output = createWorkerOutput(setup())
    try {
      expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
      ftruncateSync(output.descriptor, maxWorkerScreenshotBytes + 1)
      expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
    } finally {
      output.discard()
    }
  })

  it('does not follow a symlink or junction used as the output root', () => {
    const root = setup()
    const outside = setup()
    const link = join(root, 'results')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => createWorkerOutput(link)).toThrow('WORKER_OUTPUT_UNAVAILABLE')
    expect(readdirSync(outside)).toEqual([])
  })

  it.each(['hard link', 'regular file'])(
    'rejects an output replaced by another %s',
    (replacement) => {
      const root = setup()
      const outside = join(root, 'protected.txt')
      writeFileSync(outside, 'unchanged')
      const output = createWorkerOutput(join(root, 'results'))
      try {
        // Close the parent copy first, as production does immediately after spawning.
        output.closeDescriptor()
        renameSync(output.screenshotPath, join(output.directory, 'original.png'))
        if (replacement === 'hard link') linkSync(outside, output.screenshotPath)
        else writeFileSync(output.screenshotPath, 'replacement')
        expect(() => output.validate()).toThrow('WORKER_OUTPUT_INVALID')
        expect(readFileSync(outside, 'utf8')).toBe('unchanged')
      } finally {
        output.discard()
      }
      expect(readFileSync(outside, 'utf8')).toBe('unchanged')
    },
  )

  it('closes the parent descriptor exactly once', () => {
    const output = createWorkerOutput(setup())
    output.closeDescriptor()
    output.closeDescriptor()
    expect(() => closeSync(output.descriptor)).toThrow()
    output.discard()
  })
})
