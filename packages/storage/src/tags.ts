import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  createTagSchema,
  updateTagSchema,
  deleteTagSchema,
  environmentTagSchema,
  environmentViewSchema,
  organizationNameKey,
  tagsSchema,
  type EnvironmentTag,
} from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'

// Node 22 SQLite TEXT reads truncate embedded NUL. JSON escaping preserves legacy
// labels at the read boundary while storage/uniqueness keep their original TEXT bytes.
const tagColumns = 'tag_id, workspace_id, json_quote(name) AS name_json, revision, updated_at'
const tag = (row: Record<string, unknown>): EnvironmentTag =>
  environmentTagSchema.parse({
    workspaceId: row.workspace_id,
    id: row.tag_id,
    name: JSON.parse(String(row.name_json)),
    revision: row.revision,
    updatedAt: row.updated_at,
  })

/** One dictionary; tags_json and saved filter keys are compatibility associations, not catalogs. */
export class TagRepository {
  readonly workspaceId: string
  constructor(private readonly sqlite: DatabaseSync) {
    this.workspaceId = new WorkspaceRepository(sqlite).current().workspaceId
  }
  list(): EnvironmentTag[] {
    return this.sqlite
      .prepare(`SELECT ${tagColumns} FROM environment_tags ORDER BY name_key, tag_id`)
      .all()
      .map(tag)
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
  private insert(name: string): EnvironmentTag {
    const value = environmentTagSchema.parse({
      workspaceId: this.workspaceId,
      id: randomUUID(),
      name,
      revision: 1,
      updatedAt: new Date().toISOString(),
    })
    this.sqlite
      .prepare(
        'INSERT INTO environment_tags(tag_id, workspace_id, name, name_key, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        value.id,
        value.workspaceId,
        value.name,
        organizationNameKey(value.name),
        value.revision,
        value.updatedAt,
      )
    return value
  }
  /** Caller owns an organization write transaction; registration rolls back with the association. */
  register(names: readonly string[]): string[] {
    return names.map((name) => {
      const row = this.sqlite
        .prepare(`SELECT ${tagColumns} FROM environment_tags WHERE name_key=?`)
        .get(organizationNameKey(name))
      return (row ? tag(row) : this.insert(name)).name
    })
  }
  create(input: unknown) {
    const { name } = createTagSchema.parse(input)
    return this.transaction(() => {
      this.uniqueName(name)
      return this.insert(name)
    })
  }
  private uniqueName(name: string, except?: string) {
    const row = this.sqlite
      .prepare('SELECT tag_id FROM environment_tags WHERE name_key=?')
      .get(organizationNameKey(name))
    if (row && row.tag_id !== except) throw new Error('ORGANIZATION_NAME_EXISTS')
  }
  private current(id: string, expectedRevision: number) {
    const row = this.sqlite
      .prepare(`SELECT ${tagColumns} FROM environment_tags WHERE tag_id=?`)
      .get(id)
    if (!row) throw new Error('NOT_FOUND')
    const value = tag(row)
    if (value.revision !== expectedRevision) throw new Error('ORGANIZATION_CONFLICT')
    return value
  }
  update(input: unknown) {
    const { id, name, expectedRevision } = updateTagSchema.parse(input)
    return this.transaction(() => {
      const old = this.current(id, expectedRevision)
      this.uniqueName(name, id)
      const updatedAt = new Date().toISOString()
      this.syncAssociations(old.name, name, updatedAt)
      this.sqlite
        .prepare(
          'UPDATE environment_tags SET name=?, name_key=?, revision=revision+1, updated_at=? WHERE tag_id=?',
        )
        .run(name, organizationNameKey(name), updatedAt, id)
      return tag(
        this.sqlite.prepare(`SELECT ${tagColumns} FROM environment_tags WHERE tag_id=?`).get(id)!,
      )
    })
  }
  delete(input: unknown) {
    const { id, expectedRevision } = deleteTagSchema.parse(input)
    return this.transaction(() => {
      const old = this.current(id, expectedRevision)
      this.syncAssociations(old.name, undefined, new Date().toISOString())
      this.sqlite.prepare('DELETE FROM environment_tags WHERE tag_id=?').run(id)
      return true
    })
  }
  private syncAssociations(oldName: string, nextName: string | undefined, updatedAt: string) {
    const key = organizationNameKey(oldName)
    // Includes trashed environments. Only organizational metadata is written, never browser data/config.
    for (const row of this.sqlite
      .prepare('SELECT environment_id, tags_json FROM environment_organization')
      .all()) {
      const names = tagsSchema.parse(JSON.parse(String(row.tags_json)))
      if (!names.some((name) => organizationNameKey(name) === key)) continue
      const next = names.flatMap((name) =>
        organizationNameKey(name) !== key ? [name] : nextName === undefined ? [] : [nextName],
      )
      this.sqlite
        .prepare(
          'UPDATE environment_organization SET tags_json=?, revision=revision+1 WHERE environment_id=?',
        )
        .run(JSON.stringify(next), String(row.environment_id))
    }
    for (const row of this.sqlite
      .prepare('SELECT view_id, view_json FROM environment_views')
      .all()) {
      const view = environmentViewSchema.parse(JSON.parse(String(row.view_json)))
      if (!view.filters.tags.includes(key)) continue
      const nextKey = nextName === undefined ? undefined : organizationNameKey(nextName)
      if (nextKey === key) continue
      view.filters.tags = [
        ...new Set(
          view.filters.tags.flatMap((name) =>
            name !== key ? [name] : nextKey === undefined ? [] : [nextKey],
          ),
        ),
      ]
      this.sqlite
        .prepare(
          'UPDATE environment_views SET view_json=?, revision=revision+1, updated_at=? WHERE view_id=?',
        )
        .run(JSON.stringify(environmentViewSchema.parse(view)), updatedAt, String(row.view_id))
    }
  }
}

export function verifyTagStorage(sqlite: DatabaseSync) {
  try {
    const repo = new TagRepository(sqlite)
    const owner = sqlite
      .prepare('PRAGMA table_info(environment_tags)')
      .all()
      .find((row) => row.name === 'workspace_id')
    if (owner?.notnull !== 1 || owner.dflt_value !== `'${repo.workspaceId}'`)
      throw new Error('INVALID_OWNER_COLUMN')
    const entries = repo.list()
    if (entries.some((item) => item.workspaceId !== repo.workspaceId))
      throw new Error('INVALID_OWNER')
    const keys = new Set(entries.map((item) => organizationNameKey(item.name)))
    for (const row of sqlite
      .prepare(
        'SELECT json_quote(name) AS name_json, json_quote(name_key) AS key_json FROM environment_tags',
      )
      .all()) {
      const name: unknown = JSON.parse(String(row.name_json))
      const key: unknown = JSON.parse(String(row.key_json))
      if (
        typeof name !== 'string' ||
        name !== name.trim().normalize('NFC') ||
        key !== organizationNameKey(name)
      )
        throw new Error('INVALID_LABEL')
    }
    for (const row of sqlite.prepare('SELECT tags_json FROM environment_organization').all())
      if (
        tagsSchema
          .parse(JSON.parse(String(row.tags_json)))
          .some((name) => !keys.has(organizationNameKey(name)))
      )
        throw new Error('INVALID_TAG_REFERENCE')
    for (const row of sqlite.prepare('SELECT view_json FROM environment_views').all())
      if (
        environmentViewSchema
          .parse(JSON.parse(String(row.view_json)))
          .filters.tags.some((key) => !keys.has(key))
      )
        throw new Error('INVALID_TAG_REFERENCE')
  } catch {
    throw new Error('DATABASE_INTEGRITY_FAILED')
  }
}
