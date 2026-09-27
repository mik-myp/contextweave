import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import { EnvironmentRepository, WorkspacePaths, openLocalDatabase } from './index'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanup.splice(0).reverse()) clean()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-path-scope-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const db = openLocalDatabase(join(root, 'database.sqlite'))
  cleanup.push(db.close)
  const raw = new EnvironmentRepository(db.sqlite),
    paths = new WorkspacePaths(raw.context, root),
    repo = raw.withPaths(paths)
  const dir = paths.environmentId('same-id')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'marker'), raw.workspaceId)
  repo.create({
    config: environmentConfigSchema.parse({
      environmentId: 'same-id',
      name: 'Same display name',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      commonConfig: {},
    }),
    dataDir: dir,
    platform: 'darwin',
    arch: 'arm64',
  })
  return { root, db, raw, paths, repo, dir }
}
it('keeps identical names and IDs in independent databases on their own trusted paths', () => {
  const a = fixture(),
    b = fixture()
  expect(a.repo.workspaceId).not.toBe(b.repo.workspaceId)
  expect(a.repo.get('same-id')?.dataDir).toBe(a.dir)
  expect(b.repo.get('same-id')?.dataDir).toBe(b.dir)
  expect(() => a.paths.environment(b.repo.get('same-id')!)).toThrow('WORKSPACE_MISMATCH')
  expect(() => a.raw.withPaths(b.paths)).toThrow('WORKSPACE_MISMATCH')
  expect(readFileSync(join(a.dir, 'marker'), 'utf8')).toBe(a.repo.workspaceId)
  expect(readFileSync(join(b.dir, 'marker'), 'utf8')).toBe(b.repo.workspaceId)
})
it('refuses a persisted path into another root, without moving or editing that directory', () => {
  const a = fixture(),
    b = fixture()
  a.db.sqlite.prepare('UPDATE environments SET data_dir=?').run(b.dir)
  expect(() => a.repo.get('same-id')).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(() => a.repo.listAll()).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(readFileSync(join(b.dir, 'marker'), 'utf8')).toBe(b.repo.workspaceId)
})
it.each(['../other', '..', '/absolute', 'a/b', 'a\\b'])(
  'refuses unsafe resource segment %s',
  (id) => {
    const f = fixture()
    expect(() => f.paths.environmentId(id)).toThrow('WORKSPACE_PATH_UNSAFE')
  },
)
it('checks managed kernel identity and exact installation parent, not its display name', () => {
  const a = fixture(),
    b = fixture(),
    leaf = `darwin-arm64-${randomUUID()}`
  const record = {
    ...a.repo.context,
    kernelId: 'fingerprint-chromium',
    version: '148.0.0.1',
    platform: 'darwin',
    arch: 'arm64',
    installPath: join(a.root, 'kernels', 'fingerprint-chromium', '148.0.0.1', leaf),
  }
  expect(a.paths.kernel(record)).toBe(record.installPath)
  expect(() => a.paths.kernel({ ...record, workspaceId: b.repo.workspaceId })).toThrow(
    'WORKSPACE_MISMATCH',
  )
  expect(() =>
    a.paths.kernel({
      ...record,
      installPath: join(b.root, 'kernels', 'fingerprint-chromium', '148.0.0.1', leaf),
    }),
  ).toThrow('WORKSPACE_PATH_UNSAFE')
})
it('refuses a directory symlink instead of accessing another profile', () => {
  const a = fixture(),
    b = fixture()
  rmSync(a.dir, { recursive: true })
  symlinkSync(b.dir, a.dir, process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => a.repo.get('same-id')).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(readFileSync(join(b.dir, 'marker'), 'utf8')).toBe(b.repo.workspaceId)
})

it('refuses to bind a valid database owner to another root even before reading environment records', () => {
  const a = fixture(),
    b = fixture()
  const wrongRoot = new WorkspacePaths(a.repo.context, b.root)
  expect(() => a.raw.withPaths(wrongRoot)).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(b.repo.get('same-id')?.workspaceId).toBe(b.repo.workspaceId)
})

it('rejects noncanonical persisted traversal even when lexical resolution matches the expected path', () => {
  const a = fixture(),
    b = fixture()
  const outside = join(b.root, 'environments', 'bridge')
  mkdirSync(outside)
  symlinkSync(
    outside,
    join(a.root, 'environments', 'alias'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const indirect = [a.root, 'environments', 'alias', '..', 'same-id'].join(sep)
  a.db.sqlite.prepare('UPDATE environments SET data_dir=?').run(indirect)
  expect(() => a.repo.get('same-id')).toThrow('WORKSPACE_PATH_UNSAFE')
  const leaf = `darwin-arm64-${randomUUID()}`
  const kernel = {
    ...a.repo.context,
    kernelId: 'fingerprint-chromium',
    version: '148.0.0.1',
    platform: 'darwin',
    arch: 'arm64',
    installPath: [a.root, 'kernels', 'alias', '..', 'fingerprint-chromium', '148.0.0.1', leaf].join(
      sep,
    ),
  }
  expect(() => a.paths.kernel(kernel)).toThrow('WORKSPACE_PATH_UNSAFE')
  expect(readFileSync(join(a.dir, 'marker'), 'utf8')).toBe(a.repo.workspaceId)
  expect(readFileSync(join(b.dir, 'marker'), 'utf8')).toBe(b.repo.workspaceId)
})
