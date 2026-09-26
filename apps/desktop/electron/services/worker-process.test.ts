import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { workerForkOptions, createUtilityWorkerLauncher } from './worker-process'

describe('utility worker launch policy', () => {
  it('inherits only necessary OS environment, not Node/Electron injection or secrets', () => {
    const options = workerForkOptions({
      Path: 'system-path',
      SystemRoot: 'system-root',
      HOME: 'home',
      TMPDIR: 'temp',
      NODE_OPTIONS: '--require=steal.cjs',
      node_options: '--inspect=0',
      NODE_PATH: 'foreign-modules',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ASAR: '1',
      LD_PRELOAD: 'foreign.so',
      DYLD_INSERT_LIBRARIES: 'foreign.dylib',
      HTTP_PROXY: 'user:secret@proxy',
      AWS_SECRET_ACCESS_KEY: 'secret',
      CONTEXTWEAVE_USER_DATA: 'parent-profile',
      OTHER: undefined,
    })
    expect(options).toEqual({
      env: {
        CONTEXTWEAVE_WORKER: '1',
        Path: 'system-path',
        SystemRoot: 'system-root',
        HOME: 'home',
        TMPDIR: 'temp',
      },
      execArgv: [],
      stdio: 'ignore',
      serviceName: 'ContextWeave Worker',
      allowLoadingUnsignedLibraries: false,
    })
  })
  it('never passes Electron an empty environment map, which would restore full inheritance', () => {
    expect(
      workerForkOptions({ NODE_OPTIONS: '--require secret', CONTEXTWEAVE_WORKER: 'spoofed' }).env,
    ).toEqual({ CONTEXTWEAVE_WORKER: '1' })
  })
  it('does not mutate the parent environment', () => {
    const environment = { HOME: 'home', NODE_OPTIONS: '--inspect=0' }
    const options = workerForkOptions(environment)
    options.env!.HOME = 'child'
    expect(environment).toEqual({ HOME: 'home', NODE_OPTIONS: '--inspect=0' })
  })
})

it('does not equate a utility exit message with OS exit or kill an unowned PID', () => {
  const source = Object.assign(new EventEmitter(), {
    pid: 4321,
    kill: vi.fn(() => true),
    postMessage: vi.fn(),
  })
  const isGone = vi.fn(() => false)
  const fork = vi.fn(() => source)
  const child = createUtilityWorkerLauncher({ fork }, {}, isGone)('/private/worker.js')
  source.emit('spawn')
  expect(child.pid).toBe(4321)
  expect(child.hasExited()).toBe(false)
  source.emit('exit', 0)
  expect(child.pid).toBeUndefined()
  expect(child.hasExited()).toBe(false)
  expect(isGone).toHaveBeenCalledWith(4321)
  expect(child.kill()).toBe(false)
  expect(source.kill).not.toHaveBeenCalled()
  isGone.mockReturnValue(true)
  expect(child.hasExited()).toBe(true)
  expect(fork).toHaveBeenCalledWith('/private/worker.js', [], workerForkOptions({}))
})

it('requires ESRCH rather than treating permission or unknown probe errors as exit', () => {
  const source = Object.assign(new EventEmitter(), {
    pid: 4321,
    kill: vi.fn(() => true),
    postMessage: vi.fn(),
  })
  const child = createUtilityWorkerLauncher({ fork: () => source }, {})('/private/worker.js')
  source.emit('spawn')
  source.emit('exit', 0)
  const probe = vi.spyOn(process, 'kill')
  try {
    for (const code of ['EPERM', 'EACCES', 'UNKNOWN']) {
      probe.mockImplementation(() => {
        throw Object.assign(new Error('probe failed'), { code })
      })
      expect(child.hasExited()).toBe(false)
    }
    probe.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' })
    })
    expect(child.hasExited()).toBe(true)
    expect(probe).toHaveBeenCalledWith(4321, 0)
    expect(source.kill).not.toHaveBeenCalled()
  } finally {
    probe.mockRestore()
  }
})
