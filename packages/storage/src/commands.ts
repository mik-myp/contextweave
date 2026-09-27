import type { DatabaseSync } from 'node:sqlite'
import {
  assertWorkspaceContext,
  commandIntentDigestSchema,
  commandIdentitySchema,
  environmentCommandPageInputSchema,
  environmentCommandPageSchema,
  environmentCommandActiveSchema,
  type CommandIdentity,
  environmentCommandReceiptSchema,
  isEnvironmentCommandActive,
  type CommandErrorCode,
  type EnvironmentCommandReceipt,
} from '@contextweave/contracts'
import { WorkspaceRepository } from './workspaces'

export type { CommandIdentity } from '@contextweave/contracts'
export const maxActiveEnvironmentCommands = 100

type Terminal = Pick<EnvironmentCommandReceipt, 'status' | 'errorCode'> & {
  status: 'succeeded' | 'failed' | 'cancelled' | 'unknown'
}

/** Durable receipt facts are not an operation log and have no cleanup/delete API. */
export class EnvironmentCommandRepository {
  readonly workspaceId: string
  constructor(private readonly sqlite: DatabaseSync) {
    this.workspaceId = new WorkspaceRepository(sqlite).current().workspaceId
  }
  private transaction<T>(action: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const value = action()
      this.sqlite.exec('COMMIT')
      return value
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
  private read(row: Record<string, unknown>): EnvironmentCommandReceipt {
    commandIntentDigestSchema.parse(row.intent_digest)
    assertWorkspaceContext(this, { workspaceId: row.workspace_id })
    return environmentCommandReceiptSchema.parse({
      version: 1,
      requestId: row.request_id,
      workspaceId: row.workspace_id,
      kind: row.kind,
      environmentId: row.environment_id,
      expectedRevision: row.expected_revision,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      errorCode: row.error_code,
    })
  }
  get(requestId: string) {
    const id = environmentCommandReceiptSchema.shape.requestId.parse(requestId)
    const row = this.sqlite.prepare('SELECT * FROM environment_commands WHERE request_id=?').get(id)
    return row ? this.read(row) : undefined
  }
  page(input: unknown) {
    const query = environmentCommandPageInputSchema.parse(input)
    const before = query.beforeId
      ? this.sqlite
          .prepare('SELECT rowid FROM environment_commands WHERE request_id=?')
          .get(query.beforeId)
      : undefined
    if (query.beforeId && !before) throw new Error('COMMAND_CURSOR_INVALID')
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM environment_commands
      WHERE (? IS NULL OR rowid<?) AND (? IS NULL OR environment_id=?) ORDER BY rowid DESC LIMIT ?`,
      )
      .all(
        before?.rowid ?? null,
        before?.rowid ?? null,
        query.environmentId ?? null,
        query.environmentId ?? null,
        query.limit + 1,
      )
    const items = rows.slice(0, query.limit).map((row) => this.read(row))
    return environmentCommandPageSchema.parse({
      workspaceId: this.workspaceId,
      items,
      nextBeforeId: rows.length > query.limit ? items.at(-1)?.requestId : null,
    })
  }
  activeList() {
    return environmentCommandActiveSchema.parse({
      workspaceId: this.workspaceId,
      items: this.sqlite
        .prepare(
          "SELECT * FROM environment_commands WHERE status IN ('queued','running') ORDER BY rowid LIMIT 201",
        )
        .all()
        .map((row) => this.read(row)),
    })
  }
  /** This lookup precedes target allocation: duplicate creates keep Main's original identity. */
  match(requestId: string, intentDigest: string) {
    const id = environmentCommandReceiptSchema.shape.requestId.parse(requestId)
    const digest = commandIntentDigestSchema.parse(intentDigest)
    const row = this.sqlite.prepare('SELECT * FROM environment_commands WHERE request_id=?').get(id)
    if (!row) return undefined
    const receipt = this.read(row)
    if (row.intent_digest !== digest) throw new Error('COMMAND_INTENT_CONFLICT')
    return receipt
  }
  active(environmentId: string) {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM environment_commands WHERE environment_id=? AND status IN ('queued','running') ORDER BY (kind='stop') DESC",
      )
      .get(environmentCommandReceiptSchema.shape.environmentId.parse(environmentId))
    return row ? this.read(row) : undefined
  }
  needsInspection(environmentId: string) {
    return Boolean(
      this.sqlite
        .prepare(
          `
      SELECT 1 FROM environment_commands AS uncertain WHERE environment_id=? AND status='unknown'
      AND NOT EXISTS (SELECT 1 FROM environment_commands AS recovery
        WHERE recovery.environment_id=uncertain.environment_id AND recovery.kind='recover'
        AND recovery.status='succeeded' AND recovery.rowid>uncertain.rowid) LIMIT 1
    `,
        )
        .get(environmentId),
    )
  }
  reserve(input: CommandIdentity, rejection?: CommandErrorCode, now = new Date().toISOString()) {
    const identity = commandIdentitySchema.parse(input)
    assertWorkspaceContext(this, { workspaceId: identity.workspaceId })
    return this.transaction(() => {
      const previous = this.match(identity.requestId, identity.intentDigest)
      if (previous) {
        if (
          previous.kind !== identity.kind ||
          previous.environmentId !== identity.environmentId ||
          previous.expectedRevision !== identity.expectedRevision
        )
          throw new Error('COMMAND_INTENT_CONFLICT')
        return { created: false, receipt: previous }
      }
      const active = this.active(identity.environmentId)
      const supersedesStart = identity.kind === 'stop' && active?.kind === 'start'
      const count = Number(
        this.sqlite
          .prepare(
            "SELECT count(*) AS n FROM environment_commands WHERE status IN ('queued','running') AND (kind='stop')=?",
          )
          .get(identity.kind === 'stop' ? 1 : 0)?.n,
      )
      const errorCode =
        rejection ??
        (active && !supersedesStart
          ? 'OPERATION_IN_PROGRESS'
          : !['recover', 'stop'].includes(identity.kind) &&
              this.needsInspection(identity.environmentId)
            ? 'RECOVERY_REQUIRED'
            : count >= maxActiveEnvironmentCommands
              ? 'COMMAND_QUEUE_FULL'
              : null)
      const receipt = environmentCommandReceiptSchema.parse({
        version: 1,
        workspaceId: identity.workspaceId,
        requestId: identity.requestId,
        kind: identity.kind,
        environmentId: identity.environmentId,
        expectedRevision: identity.expectedRevision,
        status: errorCode ? 'failed' : 'queued',
        createdAt: now,
        startedAt: null,
        endedAt: errorCode ? now : null,
        errorCode,
      })
      this.sqlite
        .prepare(
          `INSERT INTO environment_commands
        (request_id,kind,environment_id,expected_revision,intent_digest,status,created_at,started_at,ended_at,error_code)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          identity.requestId,
          identity.kind,
          identity.environmentId,
          identity.expectedRevision,
          identity.intentDigest,
          receipt.status,
          now,
          null,
          receipt.endedAt,
          errorCode,
        )
      return { created: true, receipt: this.get(identity.requestId)! }
    })
  }
  start(requestId: string, now = new Date().toISOString()) {
    return this.transaction(() => {
      const previous = this.get(requestId)
      if (previous?.status !== 'queued') throw new Error('COMMAND_STATE_CONFLICT')
      this.sqlite
        .prepare(
          "UPDATE environment_commands SET status='running', started_at=? WHERE request_id=?",
        )
        .run(now, requestId)
      return this.get(requestId)!
    })
  }
  finish(requestId: string, outcome: Terminal, now = new Date().toISOString()) {
    return this.transaction(() => {
      const previous = this.get(requestId)
      if (!previous) throw new Error('NOT_FOUND')
      if (!isEnvironmentCommandActive(previous.status)) {
        if (previous.status !== outcome.status || previous.errorCode !== outcome.errorCode)
          throw new Error('COMMAND_STATE_CONFLICT')
        return previous
      }
      const next = environmentCommandReceiptSchema.parse({ ...previous, ...outcome, endedAt: now })
      this.sqlite
        .prepare(
          'UPDATE environment_commands SET status=?, ended_at=?, error_code=? WHERE request_id=?',
        )
        .run(next.status, now, next.errorCode, requestId)
      return this.get(requestId)!
    })
  }
  recoverInterrupted(now = new Date().toISOString()) {
    return this.transaction(() => {
      const result = this.sqlite
        .prepare(
          `UPDATE environment_commands SET
        status=CASE status WHEN 'queued' THEN 'cancelled' ELSE 'unknown' END,
        error_code='COMMAND_INTERRUPTED', ended_at=? WHERE status IN ('queued','running')`,
        )
        .run(now)
      return Number(result.changes)
    })
  }
}

export function verifyCommandStorage(sqlite: DatabaseSync) {
  try {
    const repository = new EnvironmentCommandRepository(sqlite)
    const column = sqlite
      .prepare('PRAGMA table_info(environment_commands)')
      .all()
      .find((row) => row.name === 'workspace_id')
    if (column?.notnull !== 1 || column.dflt_value !== `'${repository.workspaceId}'`)
      throw new Error('INVALID_OWNER')
    for (const row of sqlite.prepare('SELECT request_id FROM environment_commands').iterate())
      if (!repository.get(String(row.request_id))) throw new Error('INVALID_REQUEST_ID')
  } catch {
    throw new Error('DATABASE_INTEGRITY_FAILED')
  }
}
