import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  createGroupSchema,
  updateGroupSchema,
  reviseOrganizationItemSchema,
  createEnvironmentViewSchema,
  updateEnvironmentViewSchema,
  saveEnvironmentOrganizationSchema,
  environmentOrganizationSchema,
  environmentGroupSchema,
  savedEnvironmentViewSchema,
  organizationSnapshotSchema,
  organizationNameKey,
  type OrganizationSnapshot,
} from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'
import { organizationTables } from './organization-schema'
import { TagRepository } from './tags'

type Row = Record<string, unknown>
const group = (r: Row) =>
  environmentGroupSchema.parse({
    workspaceId: r.workspace_id,
    id: r.group_id,
    name: r.name,
    revision: r.revision,
    updatedAt: r.updated_at,
  })
const view = (r: Row) =>
  savedEnvironmentViewSchema.parse({
    workspaceId: r.workspace_id,
    id: r.view_id,
    name: r.name,
    view: JSON.parse(String(r.view_json)),
    revision: r.revision,
    updatedAt: r.updated_at,
  })
const metadata = (r: Row) =>
  environmentOrganizationSchema.parse({
    workspaceId: r.workspace_id,
    environmentId: r.environment_id,
    groupId: r.group_id ?? null,
    tags: JSON.parse(String(r.tags_json ?? '[]')),
    note: r.note ?? '',
    revision: r.revision ?? 0,
  })

/** Organizational preferences share the authoritative DB, not the browser config revision. */
export class OrganizationRepository {
  readonly workspaceId: string
  private readonly tags: TagRepository
  constructor(private readonly sqlite: DatabaseSync) {
    this.workspaceId = new WorkspaceRepository(sqlite).current().workspaceId
    this.tags = new TagRepository(sqlite)
  }
  createTag(input: unknown) {
    return this.tags.create(input)
  }
  updateTag(input: unknown) {
    return this.tags.update(input)
  }
  deleteTag(input: unknown) {
    return this.tags.delete(input)
  }
  snapshot(): OrganizationSnapshot {
    const tags = this.tags.list()
    const names = new Map(tags.map((tag) => [organizationNameKey(tag.name), tag.name]))
    return organizationSnapshotSchema.parse({
      workspaceId: this.workspaceId,
      tags,
      groups: this.sqlite
        .prepare('SELECT * FROM environment_groups ORDER BY name_key, group_id')
        .all()
        .map(group),
      environments: this.sqlite
        .prepare(
          `SELECT e.environment_id, e.workspace_id, o.group_id, o.tags_json, o.note, o.revision
        FROM environments e LEFT JOIN environment_organization o USING(environment_id) ORDER BY e.environment_id`,
        )
        .all()
        .map(metadata)
        .map((item) => ({
          ...item,
          tags: item.tags.map((name) => names.get(organizationNameKey(name)) ?? name),
        })),
      views: this.sqlite
        .prepare('SELECT * FROM environment_views ORDER BY name_key, view_id')
        .all()
        .map(view),
    })
  }
  private transaction<T>(action: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.sqlite.exec('COMMIT')
      return result
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
  private uniqueName(
    table: 'environment_groups' | 'environment_views',
    key: string,
    except?: string,
  ) {
    const field = table === 'environment_groups' ? 'group_id' : 'view_id'
    const row = this.sqlite.prepare(`SELECT ${field} FROM ${table} WHERE name_key = ?`).get(key)
    if (row && row[field] !== except) throw new Error('ORGANIZATION_NAME_EXISTS')
  }
  private current(
    table: 'environment_groups' | 'environment_views',
    id: string,
    expectedRevision: number,
  ) {
    const field = table === 'environment_groups' ? 'group_id' : 'view_id'
    const row = this.sqlite.prepare(`SELECT * FROM ${table} WHERE ${field} = ?`).get(id)
    if (!row) throw new Error('NOT_FOUND')
    if (row.revision !== expectedRevision) throw new Error('ORGANIZATION_CONFLICT')
    return row
  }
  createGroup(input: unknown) {
    const { name } = createGroupSchema.parse(input)
    return this.transaction(() => {
      this.uniqueName('environment_groups', organizationNameKey(name))
      const id = randomUUID(),
        updatedAt = new Date().toISOString()
      this.sqlite
        .prepare(
          'INSERT INTO environment_groups (group_id, workspace_id, name, name_key, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)',
        )
        .run(id, this.workspaceId, name, organizationNameKey(name), updatedAt)
      return environmentGroupSchema.parse({
        id,
        workspaceId: this.workspaceId,
        name,
        revision: 1,
        updatedAt,
      })
    })
  }
  updateGroup(input: unknown) {
    const { id, name, expectedRevision } = updateGroupSchema.parse(input)
    return this.transaction(() => {
      this.current('environment_groups', id, expectedRevision)
      this.uniqueName('environment_groups', organizationNameKey(name), id)
      this.sqlite
        .prepare(
          'UPDATE environment_groups SET name=?, name_key=?, revision=revision+1, updated_at=? WHERE group_id=?',
        )
        .run(name, organizationNameKey(name), new Date().toISOString(), id)
      return group(
        this.sqlite.prepare('SELECT * FROM environment_groups WHERE group_id=?').get(id)!,
      )
    })
  }
  deleteGroup(input: unknown) {
    const { id, expectedRevision } = reviseOrganizationItemSchema.parse(input)
    return this.transaction(() => {
      this.current('environment_groups', id, expectedRevision)
      // Atomic detach also conflicts old editors; never delete a profile or stop its runtime.
      this.sqlite
        .prepare(
          'UPDATE environment_organization SET group_id=NULL, revision=revision+1 WHERE group_id=?',
        )
        .run(id)
      this.sqlite.prepare('DELETE FROM environment_groups WHERE group_id=?').run(id)
      return true
    })
  }
  saveEnvironment(input: unknown) {
    const value = saveEnvironmentOrganizationSchema.parse(input)
    return this.transaction(() => {
      const environment = this.sqlite
        .prepare('SELECT lifecycle FROM environments WHERE environment_id=?')
        .get(value.environmentId)
      if (!environment || environment.lifecycle !== 'active') throw new Error('NOT_FOUND')
      const old = this.sqlite
        .prepare('SELECT revision FROM environment_organization WHERE environment_id=?')
        .get(value.environmentId)
      if ((old?.revision ?? 0) !== value.expectedRevision) throw new Error('ORGANIZATION_CONFLICT')
      if (
        value.groupId &&
        !this.sqlite.prepare('SELECT 1 FROM environment_groups WHERE group_id=?').get(value.groupId)
      )
        throw new Error('ORGANIZATION_GROUP_MISSING')
      this.sqlite
        .prepare(
          `INSERT INTO environment_organization
        (environment_id, workspace_id, group_id, tags_json, note, revision) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(environment_id) DO UPDATE SET group_id=excluded.group_id, tags_json=excluded.tags_json,
          note=excluded.note, revision=excluded.revision`,
        )
        .run(
          value.environmentId,
          this.workspaceId,
          value.groupId,
          JSON.stringify(this.tags.register(value.tags)),
          value.note,
          value.expectedRevision + 1,
        )
      return metadata(
        this.sqlite
          .prepare('SELECT * FROM environment_organization WHERE environment_id=?')
          .get(value.environmentId)!,
      )
    })
  }
  createView(input: unknown) {
    const value = createEnvironmentViewSchema.parse(input)
    return this.transaction(() => {
      this.uniqueName('environment_views', organizationNameKey(value.name))
      this.tags.register(value.view.filters.tags)
      const id = randomUUID(),
        updatedAt = new Date().toISOString()
      this.sqlite
        .prepare(
          'INSERT INTO environment_views (view_id, workspace_id, name, name_key, view_json, revision, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
        )
        .run(
          id,
          this.workspaceId,
          value.name,
          organizationNameKey(value.name),
          JSON.stringify(value.view),
          updatedAt,
        )
      return savedEnvironmentViewSchema.parse({
        ...value,
        id,
        workspaceId: this.workspaceId,
        revision: 1,
        updatedAt,
      })
    })
  }
  updateView(input: unknown) {
    const {
      id,
      name,
      view: preferences,
      expectedRevision,
    } = updateEnvironmentViewSchema.parse(input)
    return this.transaction(() => {
      this.current('environment_views', id, expectedRevision)
      this.uniqueName('environment_views', organizationNameKey(name), id)
      this.tags.register(preferences.filters.tags)
      this.sqlite
        .prepare(
          'UPDATE environment_views SET name=?, name_key=?, view_json=?, revision=revision+1, updated_at=? WHERE view_id=?',
        )
        .run(
          name,
          organizationNameKey(name),
          JSON.stringify(preferences),
          new Date().toISOString(),
          id,
        )
      return view(this.sqlite.prepare('SELECT * FROM environment_views WHERE view_id=?').get(id)!)
    })
  }
  deleteView(input: unknown) {
    const { id, expectedRevision } = reviseOrganizationItemSchema.parse(input)
    return this.transaction(() => {
      this.current('environment_views', id, expectedRevision)
      this.sqlite.prepare('DELETE FROM environment_views WHERE view_id=?').run(id)
      return true
    })
  }
}

export function verifyOrganizationStorage(sqlite: DatabaseSync) {
  const repo = new OrganizationRepository(sqlite)
  try {
    for (const table of organizationTables) {
      const column = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .find((row) => row.name === 'workspace_id')
      if (column?.notnull !== 1 || column.dflt_value !== `'${repo.workspaceId}'`)
        throw new Error('INVALID_OWNER_COLUMN')
      if (
        sqlite
          .prepare(`SELECT 1 FROM ${table} WHERE workspace_id != ? OR workspace_id IS NULL LIMIT 1`)
          .get(repo.workspaceId)
      )
        throw new Error('INVALID_OWNER')
    }
    const snapshot = repo.snapshot()
    // Rows loaded from disk must already be canonical, not silently repaired by parsing.
    for (const table of ['environment_groups', 'environment_views'] as const) {
      for (const row of sqlite.prepare(`SELECT name, name_key FROM ${table}`).all()) {
        if (
          typeof row.name !== 'string' ||
          row.name !== row.name.trim().normalize('NFC') ||
          row.name_key !== organizationNameKey(row.name)
        )
          throw new Error('INVALID_LABEL')
      }
    }
    if (
      snapshot.environments.some(
        (e) => e.groupId && !snapshot.groups.some((g) => g.id === e.groupId),
      )
    )
      throw new Error('INVALID_GROUP')
  } catch {
    throw new Error('DATABASE_INTEGRITY_FAILED')
  }
}
