import { dirname, join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import {
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type PathLike,
} from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkerOutput } from './worker-output'
import { ownWorkerOutputDirectory } from './worker-output-ownership'

const hooks = vi.hoisted(() => ({
  beforeOpen: undefined as ((path: PathLike, flags: string | number) => void) | undefined,
}))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    openSync: (
      path: PathLike,
      flags: string | number,
      mode?: Parameters<typeof fs.openSync>[2],
    ) => {
      hooks.beforeOpen?.(path, flags)
      return fs.openSync(path, flags, mode)
    },
  }
})
const roots: string[] = []
function root() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'cw-output-ownership-')))
  roots.push(path)
  return path
}
afterEach(() => {
  hooks.beforeOpen = undefined
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('removes only a proven empty allocation when file creation fails', () => {
  const directory = root()
  hooks.beforeOpen = (_path, flags) => {
    if (flags === 'wx') throw new Error('fixture EACCES')
  }
  expect(() => createWorkerOutput(directory)).toThrow('fixture EACCES')
  expect(readdirSync(directory)).toEqual([])
})
it('preserves unexpected entries created before a failed file allocation', () => {
  const directory = root()
  let foreign = ''
  hooks.beforeOpen = (path, flags) => {
    if (flags !== 'wx') return
    hooks.beforeOpen = undefined
    foreign = join(dirname(String(path)), 'keep.txt')
    writeFileSync(foreign, 'keep')
    throw new Error('fixture EACCES')
  }
  expect(() => createWorkerOutput(directory)).toThrow('WORKER_OUTPUT_CLEANUP_FAILED')
  expect(readFileSync(foreign, 'utf8')).toBe('keep')
})
it('does not traverse a substituted root during allocation failure rollback', () => {
  const base = root(),
    directory = join(base, 'results'),
    outside = join(base, 'outside')
  mkdirSync(outside)
  let foreign = ''
  hooks.beforeOpen = (path, flags) => {
    if (flags !== 'wx') return
    hooks.beforeOpen = undefined
    renameSync(directory, join(base, 'original'))
    symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir')
    const substituted = join(outside, basename(dirname(String(path))))
    mkdirSync(substituted)
    foreign = join(substituted, 'keep.txt')
    writeFileSync(foreign, 'keep')
    throw new Error('fixture EACCES')
  }
  expect(() => createWorkerOutput(directory)).toThrow('WORKER_OUTPUT_CLEANUP_FAILED')
  expect(readFileSync(foreign, 'utf8')).toBe('keep')
})
it('rechecks the parents after opening the candidate, before unlinking', async () => {
  const base = root(),
    directory = join(base, 'results'),
    outside = join(base, 'outside')
  mkdirSync(outside)
  const output = createWorkerOutput(directory)
  await output.close()
  let foreign = ''
  hooks.beforeOpen = (path, flags) => {
    if (flags !== 'r') return
    hooks.beforeOpen = undefined
    renameSync(directory, join(base, 'original'))
    symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir')
    const substituted = join(outside, basename(dirname(String(path))))
    mkdirSync(substituted)
    foreign = join(substituted, 'screenshot.png')
    writeFileSync(foreign, 'keep')
  }
  await expect(output.discard()).rejects.toThrow('WORKER_OUTPUT_CLEANUP_FAILED')
  expect(readFileSync(foreign, 'utf8')).toBe('keep')
  expect(existsSync(join(base, 'original', basename(output.directory), 'screenshot.png'))).toBe(
    true,
  )
})
it('refuses deletion when no file identity was captured, even for a familiar filename', () => {
  const base = root(),
    directory = join(base, 'run-fixture')
  mkdirSync(directory)
  const original = join(directory, 'screenshot.png')
  writeFileSync(original, 'keep')
  const ownership = ownWorkerOutputDirectory(base, lstatSync(base, { bigint: true }), directory)
  expect(() => ownership.discard()).toThrow('WORKER_OUTPUT_CLEANUP_FAILED')
  expect(readFileSync(original, 'utf8')).toBe('keep')
})
