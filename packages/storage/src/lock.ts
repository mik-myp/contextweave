import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type RuntimeLockOwner = {
  pid: number
  sessionId: string
  controlPort: number
  startedAt: string
}

export type RuntimeLockResult =
  | { acquired: true; lockPath: string }
  | { acquired: false; lockPath: string; owner?: RuntimeLockOwner }

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readOwner(lockPath: string): RuntimeLockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(join(lockPath, 'owner.json'), { encoding: 'utf8' })) as Partial<RuntimeLockOwner>
    if (
      typeof value.pid !== 'number'
      || typeof value.sessionId !== 'string'
      || typeof value.controlPort !== 'number'
      || typeof value.startedAt !== 'string'
    ) {
      return undefined
    }
    return value as RuntimeLockOwner
  } catch {
    return undefined
  }
}

export function runtimeLockPath(dataDir: string): string {
  return join(dataDir, '.runtime.lock')
}

export function acquireRuntimeLock(dataDir: string, owner: RuntimeLockOwner): RuntimeLockResult {
  const lockPath = runtimeLockPath(dataDir)
  try {
    mkdirSync(lockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existingOwner = readOwner(lockPath)
    if (existingOwner && isProcessAlive(existingOwner.pid)) {
      return { acquired: false, lockPath, owner: existingOwner }
    }
    rmSync(lockPath, { recursive: true, force: true })
    try {
      mkdirSync(lockPath)
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
        return { acquired: false, lockPath }
      }
      throw retryError
    }
  }

  writeFileSync(join(lockPath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  return { acquired: true, lockPath }
}

export function updateRuntimeLockOwner(dataDir: string, owner: RuntimeLockOwner): void {
  const lockPath = runtimeLockPath(dataDir)
  const currentOwner = readOwner(lockPath)
  if (!currentOwner || currentOwner.sessionId !== owner.sessionId) {
    throw new Error('Runtime lock owner mismatch')
  }
  writeFileSync(join(lockPath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

export function releaseRuntimeLock(dataDir: string, sessionId?: string): void {
  const lockPath = runtimeLockPath(dataDir)
  if (sessionId) {
    const owner = readOwner(lockPath)
    if (owner && owner.sessionId !== sessionId) return
  }
  rmSync(lockPath, { recursive: true, force: true })
}

export function inspectRuntimeLock(dataDir: string): { lockPath: string; owner?: RuntimeLockOwner; live: boolean } {
  const lockPath = runtimeLockPath(dataDir)
  const owner = readOwner(lockPath)
  return { lockPath, owner, live: owner ? isProcessAlive(owner.pid) : false }
}
