import type { DatabaseSync } from 'node:sqlite'
import {
  artifactAllocationSchema,
  artifactBudgetSchema,
  artifactBudgetUpdateSchema,
  artifactReservationSchema,
  bytesPerMiB,
  maxArtifactBytes,
  type ArtifactRecord,
  type ArtifactAllocation,
  type ArtifactBudget,
  type ArtifactBudgetUpdate,
  type ArtifactReservation,
} from '@contextweave/contracts'

/** A return acknowledges COMMIT, never a caller-owned transaction or an uncertain write. */
export function artifactWrite<T>(sqlite: DatabaseSync, write: () => T): T {
  if (!sqlite.isOpen) throw new Error('ARTIFACT_STORAGE_UNAVAILABLE')
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    const result = write()
    sqlite.exec('COMMIT')
    return result
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK')
    } catch {
      if (sqlite.isOpen) sqlite.close()
    }
    throw error
  }
}

export function readArtifactBudget(sqlite: DatabaseSync): ArtifactBudget {
  if (!sqlite.isOpen) throw new Error('ARTIFACT_STORAGE_UNAVAILABLE')
  sqlite.exec('SAVEPOINT artifact_budget_read')
  try {
    const policy = sqlite
      .prepare('SELECT limit_mib, revision FROM screenshot_budget WHERE id=1')
      .get()
    const registered = sqlite
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM screenshot_artifacts',
      )
      .get()
    const reserved = sqlite
      .prepare('SELECT COUNT(*) AS count, COUNT(*) * ? AS bytes FROM screenshot_reservations')
      .get(maxArtifactBytes)
    const result = artifactBudgetSchema.parse({
      limitMiB: policy?.limit_mib,
      revision: policy?.revision,
      registered,
      reserved,
      availableBytes: Math.max(
        0,
        Number(policy?.limit_mib) * bytesPerMiB -
          Number(registered?.bytes) -
          Number(reserved?.bytes),
      ),
    })
    sqlite.exec('RELEASE artifact_budget_read')
    return result
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK TO artifact_budget_read; RELEASE artifact_budget_read')
    } catch {
      if (sqlite.isOpen) sqlite.close()
    }
    throw error
  }
}

export function updateArtifactBudget(
  sqlite: DatabaseSync,
  input: ArtifactBudgetUpdate,
): ArtifactBudget {
  const change = artifactBudgetUpdateSchema.parse(input)
  return artifactWrite(sqlite, () => {
    const current = readArtifactBudget(sqlite)
    if (current.revision !== change.expectedRevision) throw new Error('ARTIFACT_BUDGET_CONFLICT')
    if (current.revision === Number.MAX_SAFE_INTEGER)
      throw new Error('ARTIFACT_BUDGET_REVISION_LIMIT')
    sqlite
      .prepare('UPDATE screenshot_budget SET limit_mib=?, revision=revision+1 WHERE id=1')
      .run(change.limitMiB)
    return readArtifactBudget(sqlite)
  })
}

export function reserveArtifact(sqlite: DatabaseSync, input: ArtifactReservation): void {
  const reservation = artifactReservationSchema.parse(input)
  artifactWrite(sqlite, () => {
    if (
      sqlite
        .prepare('SELECT 1 FROM screenshot_artifacts WHERE artifact_id=?')
        .get(reservation.artifactId) ||
      sqlite
        .prepare('SELECT 1 FROM screenshot_reservations WHERE artifact_id=?')
        .get(reservation.artifactId)
    )
      throw new Error('ARTIFACT_ID_CONFLICT')
    if (readArtifactBudget(sqlite).availableBytes < maxArtifactBytes)
      throw new Error('ARTIFACT_BUDGET_EXCEEDED')
    sqlite
      .prepare(
        `INSERT INTO screenshot_reservations
      (artifact_id,environment_id,task_id,reserved_at) VALUES (?,?,?,?)`,
      )
      .run(
        reservation.artifactId,
        reservation.environmentId,
        reservation.taskId,
        reservation.reservedAt,
      )
  })
}

function allocation(row: Record<string, unknown>): ArtifactAllocation {
  try {
    if (typeof row.ownership_json !== 'string' || row.ownership_json.length > 1024)
      throw new Error('ARTIFACT_RESERVATION_INVALID')
    return artifactAllocationSchema.parse({
      artifactId: row.artifact_id,
      allocationName: row.allocation_name,
      ownership: JSON.parse(row.ownership_json),
    })
  } catch {
    throw new Error('ARTIFACT_RESERVATION_INVALID')
  }
}

export function bindArtifactAllocation(sqlite: DatabaseSync, input: ArtifactAllocation): void {
  const next = artifactAllocationSchema.parse(input)
  artifactWrite(sqlite, () => {
    const row = sqlite
      .prepare('SELECT * FROM screenshot_reservations WHERE artifact_id=?')
      .get(next.artifactId)
    if (!row) throw new Error('ARTIFACT_RESERVATION_MISSING')
    if (row.allocation_name !== null) {
      if (JSON.stringify(allocation(row)) !== JSON.stringify(next))
        throw new Error('ARTIFACT_RESERVATION_CONFLICT')
      return
    }
    if (
      sqlite
        .prepare('SELECT 1 FROM screenshot_artifacts WHERE allocation_name=?')
        .get(next.allocationName)
    )
      throw new Error('ARTIFACT_RESERVATION_CONFLICT')
    sqlite
      .prepare(
        'UPDATE screenshot_reservations SET allocation_name=?,ownership_json=? WHERE artifact_id=?',
      )
      .run(next.allocationName, JSON.stringify(next.ownership), next.artifactId)
  })
}

/** Called inside the exact transaction that inserts completion and removes its reservation. */
export function requireArtifactReservation(sqlite: DatabaseSync, record: ArtifactRecord): void {
  const row = sqlite
    .prepare('SELECT * FROM screenshot_reservations WHERE artifact_id=?')
    .get(record.artifactId)
  if (!row) throw new Error('ARTIFACT_RESERVATION_MISSING')
  if (
    row.environment_id !== record.environmentId ||
    row.task_id !== record.taskId ||
    JSON.stringify(allocation(row)) !==
      JSON.stringify(
        artifactAllocationSchema.parse({
          artifactId: record.artifactId,
          allocationName: record.allocationName,
          ownership: record.ownership,
        }),
      )
  )
    throw new Error('ARTIFACT_RESERVATION_CONFLICT')
}

/** Only Main's strictly confirmed output cleanup may call this; there is no public release-ID IPC. */
export function releaseArtifactReservation(sqlite: DatabaseSync, artifactId: string): void {
  const id = artifactReservationSchema.shape.artifactId.parse(artifactId)
  artifactWrite(sqlite, () => {
    if (sqlite.prepare('SELECT 1 FROM screenshot_artifacts WHERE artifact_id=?').get(id))
      throw new Error('ARTIFACT_ALREADY_REGISTERED')
    sqlite.prepare('DELETE FROM screenshot_reservations WHERE artifact_id=?').run(id)
  })
}
