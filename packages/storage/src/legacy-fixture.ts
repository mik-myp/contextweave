import { organizationTables } from './organization-schema'
import { workspaceTables } from './workspace-scope'
// A genuine published v4 schema, not a new schema with its version lowered.
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  EnvironmentConfig,
  ProxyConfig,
  TargetPlatform,
  TargetArchitecture,
  OperationKind,
  OperationSummary,
} from '@contextweave/contracts'
import type { RuntimeSessionRecord } from './index'

export function openVersion4Fixture(filePath: string) {
  return openPublishedFixture(filePath, 4)
}

export function openVersion8Fixture(filePath: string) {
  return openPublishedFixture(filePath, 8)
}

export function openVersion9Fixture(filePath: string) {
  return openPublishedFixture(filePath, 9)
}

export function openVersion10Fixture(filePath: string) {
  return openPublishedFixture(filePath, 10)
}

function openPublishedFixture(filePath: string, version: 4 | 8 | 9 | 10) {
  const sqlite = new DatabaseSync(filePath)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  try {
    sqlite.exec('BEGIN IMMEDIATE')
    sqlite.exec(
      readFileSync(new URL(`../test-fixtures/schema-v${version}.sql`, import.meta.url), 'utf8'),
    )
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.close()
    throw error
  }
  return { sqlite, close: () => sqlite.close() }
}

/** Fixture-only old-column writer. Current repositories must not silently accept an ownerless DB. */
export function legacyFixtureWriter(sqlite: DatabaseSync) {
  const now = () => new Date().toISOString()
  const insert = (table: string, row: Record<string, SQLInputValue>) => {
    const keys = Object.keys(row)
    sqlite
      .prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...Object.values(row))
  }
  const transaction = (write: () => void) => {
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      write()
      sqlite.exec('COMMIT')
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }
  return {
    saveProxy(proxyId: string, config: ProxyConfig) {
      insert('proxies', {
        proxy_id: proxyId,
        name: config.name ?? '',
        type: config.type,
        host: config.host,
        port: config.port,
        username: config.username ?? null,
        credential_ref: config.credentialRef ?? null,
        created_at: now(),
        updated_at: now(),
      })
      return config
    },
    create(input: {
      config: EnvironmentConfig
      dataDir: string
      platform: TargetPlatform
      arch: TargetArchitecture
    }) {
      const c = input.config,
        time = now()
      transaction(() => {
        insert('environments', {
          environment_id: c.environmentId,
          name: c.name,
          status: 'created',
          kernel_id: c.kernelId,
          kernel_version: c.kernelVersion,
          proxy_id: c.proxyId ?? null,
          config_json: JSON.stringify(c),
          data_dir: input.dataDir,
          platform: input.platform,
          arch: input.arch,
          created_at: time,
          updated_at: time,
          revision: 1,
          lifecycle: 'active',
          trashed_at: null,
        })
        insert('environment_revisions', {
          environment_id: c.environmentId,
          revision: 1,
          config_json: JSON.stringify(c),
          created_at: time,
        })
      })
    },
    updateConfig(config: EnvironmentConfig, revision: number) {
      transaction(() => {
        const json = JSON.stringify(config),
          time = now()
        sqlite
          .prepare(
            'UPDATE environments SET name=?, config_json=?, updated_at=?, revision=revision+1 WHERE environment_id=? AND revision=?',
          )
          .run(config.name, json, time, config.environmentId, revision)
        insert('environment_revisions', {
          environment_id: config.environmentId,
          revision: revision + 1,
          config_json: json,
          created_at: time,
        })
      })
    },
    deleteEnvironment(id: string) {
      sqlite
        .prepare(
          "UPDATE environments SET lifecycle='trashed', trashed_at=?, updated_at=? WHERE environment_id=?",
        )
        .run(now(), now(), id)
    },
    setSetting(key: string, value: unknown) {
      insert('app_settings', {
        setting_key: key,
        value_json: JSON.stringify(value),
        updated_at: now(),
      })
    },
    createRuntimeSession(s: Omit<RuntimeSessionRecord, 'workspaceId'>) {
      insert('runtime_sessions', {
        session_id: s.sessionId,
        environment_id: s.environmentId,
        pid: s.pid,
        control_port: s.controlPort,
        started_at: s.startedAt,
        status: s.status,
        exit_reason: s.exitReason,
        ended_at: s.endedAt ?? null,
        revision: s.revision ?? null,
        kernel_version: s.kernelVersion ?? null,
        executable_version: s.executableVersion ?? null,
        phase: s.phase ?? 'launch',
        process_identity: s.processIdentity ?? null,
      })
    },
    createOperation(id: string, kind: OperationKind, environmentId: string | null) {
      insert('operations', {
        operation_id: id,
        environment_id: environmentId,
        kind,
        status: 'running',
        phase: 'queued',
        started_at: now(),
        ended_at: null,
        error_code: null,
      })
    },
    updateOperation(id: string, phase: string, status: OperationSummary['status']) {
      sqlite
        .prepare('UPDATE operations SET phase=?, status=?, ended_at=? WHERE operation_id=?')
        .run(phase, status, now(), id)
    },
    scheduleCredentialCleanup(reference: string) {
      insert('credential_cleanup', { credential_ref: reference, created_at: now() })
    },
  }
}

/** Compare every legacy column; new ownership is independently asserted by scope migration tests. */
export function legacyRows(sqlite: DatabaseSync, table: string, order = 'rowid') {
  return sqlite
    .prepare(`SELECT * FROM ${table} ORDER BY ${order}`)
    .all()
    .map(({ workspace_id: _newOwnerColumn, ...legacy }) => legacy)
}

/** Remove v10's actual columns/constraints before deriving an older additive fixture. */
export function removeWorkspaceScopeForLegacyFixture(sqlite: DatabaseSync) {
  sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
  try {
    for (const table of organizationTables) sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
    for (const table of workspaceTables)
      sqlite.exec(`ALTER TABLE ${table} DROP COLUMN workspace_id`)
    sqlite.exec('DROP TABLE local_workspace; COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  } finally {
    sqlite.exec('PRAGMA foreign_keys=ON')
  }
}

/** Keep byte-for-byte legacy DDL comparison after removing only the exact v10 ADD COLUMN. */
export function withoutWorkspaceColumn(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    if (typeof row.sql !== 'string') return row
    return {
      ...row,
      sql: row.sql.replace(
        /, workspace_id TEXT NOT NULL\s+DEFAULT '([0-9a-f-]{36})' CHECK\(workspace_id = '\1'\)\s+REFERENCES local_workspace\(workspace_id\) ON DELETE RESTRICT ON UPDATE RESTRICT/,
        '',
      ),
    }
  })
}
