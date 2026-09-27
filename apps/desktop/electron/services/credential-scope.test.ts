import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspacePaths } from '@contextweave/storage'
import { createWorkspaceCredentialStore } from './credentials'
const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const clean of cleanup.splice(0).reverse()) clean()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-credential-scope-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const context = { workspaceId: randomUUID() },
    paths = new WorkspacePaths(context, root)
  const secure = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  }
  const credentials = createWorkspaceCredentialStore(context, paths, secure)
  const reference = { ...context, reference: 'same-opaque-key' }
  return { root, context, paths, secure, credentials, reference }
}
it('keeps identical credential keys isolated, retaining the existing encrypted file format', () => {
  const a = fixture(),
    b = fixture()
  a.credentials.save(a.reference, 'first')
  b.credentials.save(b.reference, 'second')
  expect(a.credentials.read(a.reference)).toBe('first')
  expect(b.credentials.read(b.reference)).toBe('second')
  expect(JSON.parse(readFileSync(join(a.root, 'credentials.json'), 'utf8'))).toEqual({
    'same-opaque-key': Buffer.from('first').toString('base64'),
  })
  const beforeA = readFileSync(join(a.root, 'credentials.json')),
    beforeB = readFileSync(join(b.root, 'credentials.json'))
  a.secure.decryptString.mockClear()
  a.secure.encryptString.mockClear()
  const pathAccess = vi.spyOn(a.paths, 'credentials')
  for (const operation of [
    () => a.credentials.read(b.reference),
    () => a.credentials.save(b.reference, 'wrong'),
    () => a.credentials.remove(b.reference),
  ])
    expect(operation).toThrow('WORKSPACE_MISMATCH')
  expect(pathAccess).not.toHaveBeenCalled()
  expect(a.secure.decryptString).not.toHaveBeenCalled()
  expect(a.secure.encryptString).not.toHaveBeenCalled()
  expect(readFileSync(join(a.root, 'credentials.json'))).toEqual(beforeA)
  expect(readFileSync(join(b.root, 'credentials.json'))).toEqual(beforeB)
})
it('rejects missing, malformed or extended references before any file access', () => {
  const f = fixture(),
    access = vi.spyOn(f.paths, 'credentials')
  for (const reference of [
    'same-opaque-key',
    {},
    { reference: 'same-opaque-key' },
    { ...f.reference, path: '/other' },
  ])
    expect(() => Reflect.apply(f.credentials.read, undefined, [reference])).toThrow()
  expect(access).not.toHaveBeenCalled()
  expect(f.secure.isEncryptionAvailable).not.toHaveBeenCalled()
})
it('rechecks file kind on every operation rather than trusting an old resolved path', () => {
  const f = fixture()
  f.credentials.save(f.reference, 'retained')
  rmSync(join(f.root, 'credentials.json'))
  mkdirSync(join(f.root, 'credentials.json'))
  f.secure.decryptString.mockClear()
  f.secure.encryptString.mockClear()
  expect(() => f.credentials.read(f.reference)).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(() => f.credentials.save(f.reference, 'new')).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(f.secure.decryptString).not.toHaveBeenCalled()
  expect(f.secure.encryptString).not.toHaveBeenCalled()
})
