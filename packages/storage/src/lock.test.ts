import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  lstatSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireRuntimeLock,
  inspectRuntimeLock,
  releaseRuntimeLock,
  runtimeLockPath,
  updateRuntimeLockOwner,
} from './lock'
import { isRuntimeProcessAlive, readProcessIdentity } from './process-identity'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-lock-'))
  roots.push(root)
  return {
    root,
    owner: {
      pid: process.pid,
      sessionId: 'session-test',
      controlPort: 9222,
      startedAt: new Date().toISOString(),
      processIdentity: readProcessIdentity(process.pid),
    },
  }
}
describe('atomic runtime ownership', () => {
  it('publishes a complete file and atomically replaces its owner without temporary debris', () => {
    const { root, owner } = fixture()
    expect(owner.processIdentity).toBeTruthy()
    expect(acquireRuntimeLock(root, owner).acquired).toBe(true)
    expect(lstatSync(runtimeLockPath(root)).isFile()).toBe(true)
    expect(inspectRuntimeLock(root)).toMatchObject({ live: true, owner })
    updateRuntimeLockOwner(root, { ...owner, pid: 2147483647, processIdentity: undefined })
    expect(inspectRuntimeLock(root).live).toBe(false)
    expect(readdirSync(root)).toEqual(['.runtime.lock'])
    releaseRuntimeLock(root, owner.sessionId)
    expect(readdirSync(root)).toEqual([])
  })
  it('does not steal even a dead owner or release a foreign session', () => {
    const { root, owner } = fixture()
    acquireRuntimeLock(root, { ...owner, pid: 2147483647 })
    const before = readFileSync(runtimeLockPath(root))
    expect(acquireRuntimeLock(root, { ...owner, sessionId: 'new' }).acquired).toBe(false)
    releaseRuntimeLock(root, 'new')
    expect(readFileSync(runtimeLockPath(root))).toEqual(before)
    expect(() => updateRuntimeLockOwner(root, { ...owner, sessionId: 'new' })).toThrow(
      'owner mismatch',
    )
  })
  it.each(['directory', 'partial-file', 'invalid-owner'])(
    'preserves unreadable %s instead of guessing it is stale',
    (kind) => {
      const { root, owner } = fixture()
      if (kind === 'directory') mkdirSync(runtimeLockPath(root))
      else
        writeFileSync(
          runtimeLockPath(root),
          kind === 'partial-file' ? '{' : JSON.stringify({ ...owner, pid: -1 }),
        )
      expect(inspectRuntimeLock(root).owner).toBeUndefined()
      expect(acquireRuntimeLock(root, owner).acquired).toBe(false)
      releaseRuntimeLock(root, owner.sessionId)
      expect(existsSync(runtimeLockPath(root))).toBe(true)
    },
  )
  it('recognizes a reused PID but is conservative with legacy or unreadable identity', () => {
    const { owner } = fixture()
    expect(isRuntimeProcessAlive(process.pid, owner.processIdentity)).toBe(true)
    expect(isRuntimeProcessAlive(process.pid, 'previous-process')).toBe(false)
    expect(isRuntimeProcessAlive(process.pid)).toBe(true)
    expect(isRuntimeProcessAlive(2147483647, owner.processIdentity)).toBe(false)
    expect(readProcessIdentity(-1)).toBeUndefined()
  })
  it('reads and safely updates legacy directory ownership', () => {
    const { root, owner } = fixture()
    mkdirSync(runtimeLockPath(root))
    writeFileSync(join(runtimeLockPath(root), 'owner.json'), JSON.stringify(owner))
    expect(inspectRuntimeLock(root).live).toBe(true)
    updateRuntimeLockOwner(root, { ...owner, controlPort: 9333 })
    expect(inspectRuntimeLock(root).owner?.controlPort).toBe(9333)
    releaseRuntimeLock(root, owner.sessionId)
    expect(existsSync(runtimeLockPath(root))).toBe(false)
  })
})

it('does not publish an incomplete owner after a validation/write failure', () => {
  const { root, owner } = fixture()
  expect(() => acquireRuntimeLock(root, { ...owner, pid: -1 })).toThrow()
  expect(readdirSync(root)).toEqual([])
})
