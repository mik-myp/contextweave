import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { isRuntimeProcessAlive } from './process-identity'
export { isProcessAlive, isRuntimeProcessAlive, readProcessIdentity } from './process-identity'

const ownerSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  controlPort: z.number().int().min(1).max(65535),
  startedAt: z.string().datetime(),
  processIdentity: z.string().min(1).optional(),
})
export type RuntimeLockOwner = z.infer<typeof ownerSchema>
export type RuntimeLockResult =
  | { acquired: true; lockPath: string }
  | { acquired: false; lockPath: string; owner?: RuntimeLockOwner }

function ownerPath(lockPath: string): string {
  const stat = lstatSync(lockPath)
  if (stat.isSymbolicLink()) throw new Error('Runtime lock cannot be a symbolic link')
  const path = stat.isDirectory() ? join(lockPath, 'owner.json') : lockPath
  if (!lstatSync(path).isFile()) throw new Error('Runtime lock must be a regular file')
  return path
}
function readOwner(lockPath: string): RuntimeLockOwner | undefined {
  try {
    return ownerSchema.parse(JSON.parse(readFileSync(ownerPath(lockPath), 'utf8')))
  } catch {
    return undefined
  }
}
export function runtimeLockPath(dataDir: string): string {
  return join(dataDir, '.runtime.lock')
}

function writeOwner(path: string, owner: RuntimeLockOwner) {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(ownerSchema.parse(owner))}\n`, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
export function acquireRuntimeLock(dataDir: string, owner: RuntimeLockOwner): RuntimeLockResult {
  const lockPath = runtimeLockPath(dataDir)
  const temporary = `${lockPath}.${randomUUID()}.tmp`
  try {
    writeOwner(temporary, owner)
    try {
      // Publishing a fully written inode is exclusive and cannot replace another owner.
      linkSync(temporary, lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return { acquired: false, lockPath, owner: readOwner(lockPath) }
    }
    return { acquired: true, lockPath }
  } finally {
    rmSync(temporary, { force: true })
  }
}
export function updateRuntimeLockOwner(dataDir: string, owner: RuntimeLockOwner): void {
  const lockPath = runtimeLockPath(dataDir)
  const current = readOwner(lockPath)
  if (!current || current.sessionId !== owner.sessionId)
    throw new Error('Runtime lock owner mismatch')
  const path = ownerPath(lockPath)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeOwner(temporary, owner)
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}
export function releaseRuntimeLock(dataDir: string, sessionId?: string): void {
  const lockPath = runtimeLockPath(dataDir)
  const owner = readOwner(lockPath)
  // Never delete unreadable/foreign ownership; recovery must not guess.
  if (!owner || !sessionId || owner.sessionId !== sessionId) return
  if (lstatSync(lockPath).isDirectory()) rmSync(lockPath, { recursive: true })
  else unlinkSync(lockPath)
}
export function inspectRuntimeLock(dataDir: string): {
  lockPath: string
  owner?: RuntimeLockOwner
  live: boolean
} {
  const lockPath = runtimeLockPath(dataDir)
  const owner = readOwner(lockPath)
  return {
    lockPath,
    owner,
    live: owner ? isRuntimeProcessAlive(owner.pid, owner.processIdentity) : false,
  }
}
