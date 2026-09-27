import {
  artifactWrite,
  readArtifactBudget,
  updateArtifactBudget,
  reserveArtifact,
  bindArtifactAllocation,
  requireArtifactReservation,
  releaseArtifactReservation,
} from './artifact-budget'
import { WorkspaceRepository, databaseFilePath } from './workspaces'
import type { DatabaseSync } from 'node:sqlite'
import {
  artifactRecordSchema,
  artifactQuerySchema,
  artifactPageSchema,
  type ArtifactRecord,
  type ArtifactPage,
  type ArtifactBudgetUpdate,
  type ArtifactReservation,
  type ArtifactAllocation,
} from '@contextweave/contracts'

function mapRecord(row: Record<string, unknown>): ArtifactRecord {
  try {
    if (typeof row.ownership_json !== 'string' || row.ownership_json.length > 1024)
      throw new Error('ARTIFACT_RECORD_INVALID')
    return artifactRecordSchema.parse({
      artifactId: row.artifact_id,
      environmentId: row.environment_id,
      taskId: row.task_id,
      allocationName: row.allocation_name,
      bytes: row.bytes,
      sha256: row.sha256,
      completedAt: row.completed_at,
      ownership: JSON.parse(row.ownership_json),
    })
  } catch {
    throw new Error('ARTIFACT_RECORD_INVALID')
  }
}

export function registerArtifact(sqlite: DatabaseSync, input: ArtifactRecord): void {
  const record = artifactRecordSchema.parse(input)
  // Never join a caller's transaction: a successful return must mean an actual COMMIT.
  artifactWrite(sqlite, () => {
    const existing = sqlite
      .prepare('SELECT * FROM screenshot_artifacts WHERE artifact_id = ?')
      .get(record.artifactId)
    if (existing) {
      if (
        sqlite
          .prepare('SELECT 1 FROM screenshot_reservations WHERE artifact_id=?')
          .get(record.artifactId)
      )
        throw new Error('ARTIFACT_RESERVATION_CONFLICT')
      if (JSON.stringify(mapRecord(existing)) !== JSON.stringify(record))
        throw new Error('ARTIFACT_ID_CONFLICT')
    } else {
      requireArtifactReservation(sqlite, record)
      sqlite
        .prepare(
          `INSERT INTO screenshot_artifacts
        (artifact_id, environment_id, task_id, allocation_name, bytes, sha256, completed_at, ownership_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.artifactId,
          record.environmentId,
          record.taskId,
          record.allocationName,
          record.bytes,
          record.sha256,
          record.completedAt,
          JSON.stringify(record.ownership),
        )
    }
    sqlite.prepare('DELETE FROM screenshot_reservations WHERE artifact_id=?').run(record.artifactId)
  })
}

export function readArtifactPage(sqlite: DatabaseSync, input: unknown): ArtifactPage {
  const { limit, cursor } = artifactQuerySchema.parse(input)
  const previous = cursor?.side === 'previous'
  const comparison = previous ? '>' : '<'
  sqlite.exec('SAVEPOINT artifact_page')
  try {
    const rows = sqlite
      .prepare(
        `SELECT a.*, substr(e.name, 1, 100) AS environment_name FROM screenshot_artifacts a
      JOIN environments e ON e.environment_id = a.environment_id
      ${cursor ? `WHERE (a.completed_at, a.artifact_id) ${comparison} (?, ?)` : ''}
      ORDER BY a.completed_at ${previous ? 'ASC' : 'DESC'}, a.artifact_id ${previous ? 'ASC' : 'DESC'} LIMIT ?`,
      )
      .all(...(cursor ? [cursor.completedAt, cursor.artifactId] : []), limit)
    if (previous) rows.reverse()
    const items = rows.map((row) => {
      const { artifactId, environmentId, taskId, bytes, sha256, completedAt } = mapRecord(row)
      return {
        artifactId,
        environmentId,
        taskId,
        bytes,
        sha256,
        completedAt,
        environmentName: row.environment_name,
      }
    })
    const boundary = (item: (typeof items)[number] | undefined, side: 'previous' | 'next') => {
      if (
        !item ||
        !sqlite
          .prepare(
            `SELECT 1 FROM screenshot_artifacts WHERE (completed_at, artifact_id) ${side === 'previous' ? '>' : '<'} (?, ?) LIMIT 1`,
          )
          .get(item.completedAt, item.artifactId)
      )
        return null
      return {
        completedAt: item.completedAt,
        artifactId: item.artifactId,
        side,
      }
    }
    const totals = sqlite
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM screenshot_artifacts',
      )
      .get()
    const result = artifactPageSchema.parse({
      items,
      totals,
      previousCursor: boundary(items[0], 'previous'),
      nextCursor: boundary(items.at(-1), 'next'),
    })
    sqlite.exec('RELEASE artifact_page')
    return result
  } catch (error) {
    sqlite.exec('ROLLBACK TO artifact_page; RELEASE artifact_page')
    throw error
  }
}

/** A separate connection to the same file keeps uncertain artifact transactions out of runtime state. */
export class ArtifactRepository {
  readonly workspaceId: string
  readonly databasePath: string
  constructor(private readonly sqlite: DatabaseSync) {
    this.workspaceId = new WorkspaceRepository(sqlite).current().workspaceId
    this.databasePath = databaseFilePath(sqlite)
  }
  budget() {
    return readArtifactBudget(this.sqlite)
  }
  updateBudget(input: ArtifactBudgetUpdate) {
    return updateArtifactBudget(this.sqlite, input)
  }
  reserve(input: ArtifactReservation) {
    reserveArtifact(this.sqlite, input)
  }
  bindAllocation(input: ArtifactAllocation) {
    bindArtifactAllocation(this.sqlite, input)
  }
  releaseReservation(artifactId: string) {
    releaseArtifactReservation(this.sqlite, artifactId)
  }
  registerArtifact(record: ArtifactRecord): void {
    registerArtifact(this.sqlite, record)
  }
  pageArtifacts(input: unknown): ArtifactPage {
    if (!this.sqlite.isOpen) throw new Error('ARTIFACT_STORAGE_UNAVAILABLE')
    return readArtifactPage(this.sqlite, input)
  }
}
