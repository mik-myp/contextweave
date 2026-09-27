import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  assertWorkspaceContext,
  workspaceContextSchema,
  type WorkspaceContext,
} from '@contextweave/contracts'

type EnvironmentPathRecord = WorkspaceContext & { environmentId: string; dataDir: string }
type KernelPathRecord = WorkspaceContext & {
  kernelId: string
  version: string
  platform: string
  arch: string
  installPath: string
}

/** Main supplies the root; Renderer and persisted display names never choose it. */
export class WorkspacePaths {
  readonly context: Readonly<WorkspaceContext>
  readonly root: string
  constructor(context: WorkspaceContext, root: string) {
    this.context = Object.freeze(workspaceContextSchema.parse(context))
    if (!isAbsolute(root)) throw new Error('WORKSPACE_PATH_UNSAFE')
    this.root = resolve(root)
    this.directory([])
  }

  private segment(value: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value) || value === '.' || value === '..')
      throw new Error('WORKSPACE_PATH_UNSAFE')
    return value
  }

  private inspect(path: string, kind: 'file' | 'directory'): boolean {
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()))
        throw new Error('WORKSPACE_PATH_UNSAFE')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private directory(parts: string[]): string {
    let path = this.root
    // Check each controlled component. Do not create, move, delete or follow links.
    this.inspect(path, 'directory')
    for (const part of parts) {
      path = join(path, this.segment(part))
      this.inspect(path, 'directory')
    }
    return path
  }

  /** Recheck at dispatch, not just startup: a replaced root must fail before side effects. */
  assertRoots(): void {
    this.environments()
    this.kernels()
    this.credentials()
    this.workerResults()
  }

  assertDatabase(file: string): void {
    if (!isAbsolute(file)) throw new Error('WORKSPACE_PATH_UNSAFE')
    this.directory([])
    if (!this.inspect(file, 'file') || realpathSync(dirname(file)) !== realpathSync(this.root))
      throw new Error('WORKSPACE_PATH_UNSAFE')
  }

  environments(): string {
    return this.directory(['environments'])
  }
  kernels(): string {
    return this.directory(['kernels'])
  }
  workerResults(): string {
    return this.directory(['worker-results'])
  }
  credentials(): string {
    this.directory([])
    const file = join(this.root, 'credentials.json')
    this.inspect(file, 'file')
    return file
  }
  environmentId(environmentId: string): string {
    return this.directory(['environments', this.segment(environmentId)])
  }
  environment(record: EnvironmentPathRecord): string {
    assertWorkspaceContext(this.context, { workspaceId: record.workspaceId })
    // Require the exact canonical path before touching the persisted value. Merely
    // comparing resolve(value) is insufficient: an alias/../ segment can follow a
    // symlink before ".." is processed by the filesystem, reaching another root.
    const expected = join(this.root, 'environments', this.segment(record.environmentId))
    if (!isAbsolute(record.dataDir) || record.dataDir !== expected)
      throw new Error('WORKSPACE_PATH_UNSAFE')
    return this.environmentId(record.environmentId)
  }
  kernel(record: KernelPathRecord): string {
    assertWorkspaceContext(this.context, { workspaceId: record.workspaceId })
    const parent = join(
      this.root,
      'kernels',
      this.segment(record.kernelId),
      this.segment(record.version),
    )
    const leaf = basename(record.installPath)
    const prefix = `${this.segment(record.platform)}-${this.segment(record.arch)}-`
    if (
      !isAbsolute(record.installPath) ||
      record.installPath !== resolve(record.installPath) ||
      dirname(record.installPath) !== parent ||
      !leaf.startsWith(prefix) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        leaf.slice(prefix.length),
      )
    )
      throw new Error('WORKSPACE_PATH_UNSAFE')
    return this.directory(['kernels', record.kernelId, record.version, leaf])
  }
}
