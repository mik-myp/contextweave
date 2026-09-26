import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { environmentConfigSchema } from '@contextweave/contracts'
import type {
  EnvironmentConfig,
  OperationKind,
  OperationSummary,
  EnvironmentStatus,
  ProxyConfig,
  RuntimeSession,
  TargetArchitecture,
  TargetPlatform,
} from '@contextweave/contracts'

import { migrateDatabase, databaseVersion } from './migrations'

type Row = Record<string, unknown>

export type LocalDatabase = {
  sqlite: DatabaseSync
  close: () => void
}

export function openLocalDatabase(filePath: string): LocalDatabase {
  mkdirSync(dirname(filePath), { recursive: true })
  const sqlite = new DatabaseSync(filePath)
  try {
    const integrity = sqlite.prepare('PRAGMA quick_check(1)').get()
    if (integrity?.quick_check !== 'ok') throw new Error('DATABASE_CORRUPT')
    if (Number(sqlite.prepare('PRAGMA user_version').get()?.user_version) > databaseVersion)
      throw new Error('This database requires a newer ContextWeave version')
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    migrateDatabase(sqlite, filePath)
    return { sqlite, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export type EnvironmentRecord = {
  environmentId: string
  name: string
  status: EnvironmentStatus
  kernelId: string
  kernelVersion: string
  proxyId: string | null
  configJson: string
  revision: number
  lifecycle: 'active' | 'trashed'
  trashedAt: string | null
  dataDir: string
  platform: TargetPlatform
  arch: TargetArchitecture
  createdAt: string
  updatedAt: string
}

export type RuntimeSessionRecord = RuntimeSession & {
  exitReason: string | null
}

export type ProxyRecord = ProxyConfig & {
  proxyId: string
  createdAt: string
  updatedAt: string
}

export type KernelInstallationRecord = {
  id: number
  kernelId: string
  version: string
  platform: TargetPlatform
  arch: TargetArchitecture
  sourceUrl: string | null
  sha256: string | null
  installPath: string
  state: string
  createdAt: string
  updatedAt: string
}

function stringValue(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Expected ${key} to be a string`)
  return value
}

function nullableStringValue(row: Row, key: string): string | null {
  const value = row[key]
  return value === null || value === undefined ? null : stringValue(row, key)
}

function mapEnvironment(row: Row): EnvironmentRecord {
  return {
    environmentId: stringValue(row, 'environment_id'),
    name: stringValue(row, 'name'),
    status: stringValue(row, 'status') as EnvironmentStatus,
    kernelId: stringValue(row, 'kernel_id'),
    kernelVersion: stringValue(row, 'kernel_version'),
    proxyId: nullableStringValue(row, 'proxy_id'),
    configJson: stringValue(row, 'config_json'),
    revision: Number(row.revision),
    lifecycle: stringValue(row, 'lifecycle') as EnvironmentRecord['lifecycle'],
    trashedAt: nullableStringValue(row, 'trashed_at'),
    dataDir: stringValue(row, 'data_dir'),
    platform: stringValue(row, 'platform') as TargetPlatform,
    arch: stringValue(row, 'arch') as TargetArchitecture,
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  }
}

function mapRuntimeSession(row: Row): RuntimeSessionRecord {
  return {
    sessionId: stringValue(row, 'session_id'),
    environmentId: stringValue(row, 'environment_id'),
    pid: Number(row.pid),
    processIdentity: nullableStringValue(row, 'process_identity') ?? undefined,
    controlPort: Number(row.control_port),
    startedAt: stringValue(row, 'started_at'),
    status: stringValue(row, 'status') as RuntimeSession['status'],
    exitReason: nullableStringValue(row, 'exit_reason'),
    endedAt: nullableStringValue(row, 'ended_at'),
    revision: row.revision == null ? undefined : Number(row.revision),
    kernelVersion: nullableStringValue(row, 'kernel_version') ?? undefined,
    executableVersion: nullableStringValue(row, 'executable_version') ?? undefined,
    phase: stringValue(row, 'phase'),
  }
}

function mapProxy(row: Row): ProxyRecord {
  return {
    proxyId: stringValue(row, 'proxy_id'),
    name: stringValue(row, 'name'),
    type: stringValue(row, 'type') as ProxyConfig['type'],
    host: stringValue(row, 'host'),
    port: Number(row.port),
    username: nullableStringValue(row, 'username') ?? undefined,
    credentialRef: nullableStringValue(row, 'credential_ref') ?? undefined,
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  }
}

function mapKernelInstallation(row: Row): KernelInstallationRecord {
  return {
    id: Number(row.id),
    kernelId: stringValue(row, 'kernel_id'),
    version: stringValue(row, 'version'),
    platform: stringValue(row, 'platform') as TargetPlatform,
    arch: stringValue(row, 'arch') as TargetArchitecture,
    sourceUrl: nullableStringValue(row, 'source_url'),
    sha256: nullableStringValue(row, 'sha256'),
    installPath: stringValue(row, 'install_path'),
    state: stringValue(row, 'state'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  }
}

export class EnvironmentRepository {
  private readonly listStatement: StatementSync
  private readonly getStatement: StatementSync
  private readonly insertStatement: StatementSync
  private readonly updateConfigStatement: StatementSync
  private readonly updateStatusStatement: StatementSync
  private readonly listRuntimeSessionsStatement: StatementSync
  private readonly getRuntimeSessionStatement: StatementSync
  private readonly insertRuntimeSessionStatement: StatementSync
  private readonly updateRuntimeSessionStatement: StatementSync
  private readonly deleteRuntimeSessionStatement: StatementSync
  private readonly listProxyStatement: StatementSync
  private readonly getProxyStatement: StatementSync
  private readonly insertProxyStatement: StatementSync
  private readonly deleteProxyStatement: StatementSync
  private readonly getSettingStatement: StatementSync
  private readonly upsertSettingStatement: StatementSync
  private readonly listKernelInstallationsStatement: StatementSync
  private readonly getKernelInstallationStatement: StatementSync
  private readonly insertKernelInstallationStatement: StatementSync

  constructor(private readonly sqlite: DatabaseSync) {
    this.listStatement = sqlite.prepare(
      "SELECT * FROM environments WHERE lifecycle = 'active' ORDER BY updated_at DESC",
    )
    this.getStatement = sqlite.prepare('SELECT * FROM environments WHERE environment_id = ?')
    this.insertStatement = sqlite.prepare(`
      INSERT INTO environments (
        environment_id, name, status, kernel_id, kernel_version, proxy_id,
        config_json, data_dir, platform, arch, created_at, updated_at
      ) VALUES (@environmentId, @name, @status, @kernelId, @kernelVersion, @proxyId,
        @configJson, @dataDir, @platform, @arch, @createdAt, @updatedAt)
    `)
    this.updateConfigStatement = sqlite.prepare(
      'UPDATE environments SET name = ?, proxy_id = ?, config_json = ?, updated_at = ?, revision = revision + 1 WHERE environment_id = ? AND revision = ?',
    )
    this.updateStatusStatement = sqlite.prepare(
      'UPDATE environments SET status = ?, updated_at = ? WHERE environment_id = ?',
    )
    this.listRuntimeSessionsStatement = sqlite.prepare(
      'SELECT * FROM runtime_sessions ORDER BY started_at DESC',
    )
    this.getRuntimeSessionStatement = sqlite.prepare(
      'SELECT * FROM runtime_sessions WHERE session_id = ?',
    )
    this.insertRuntimeSessionStatement = sqlite.prepare(`
      INSERT INTO runtime_sessions (
        session_id, environment_id, pid, control_port, started_at, status, exit_reason, ended_at, revision, kernel_version, executable_version, phase, process_identity
      ) VALUES (@sessionId, @environmentId, @pid, @controlPort, @startedAt, @status, @exitReason, @endedAt, @revision, @kernelVersion, @executableVersion, @phase, @processIdentity)
    `)
    this.updateRuntimeSessionStatement = sqlite.prepare(`
      UPDATE runtime_sessions SET status = ?, exit_reason = ?, ended_at = COALESCE(ended_at, ?), phase = ? WHERE session_id = ?
    `)
    this.deleteRuntimeSessionStatement = sqlite.prepare(
      'DELETE FROM runtime_sessions WHERE session_id = ?',
    )
    this.listProxyStatement = sqlite.prepare('SELECT * FROM proxies ORDER BY updated_at DESC')
    this.getProxyStatement = sqlite.prepare('SELECT * FROM proxies WHERE proxy_id = ?')
    this.insertProxyStatement = sqlite.prepare(`
      INSERT INTO proxies (
        proxy_id, name, type, host, port, username, credential_ref, created_at, updated_at
      ) VALUES (@proxyId, @name, @type, @host, @port, @username, @credentialRef, @createdAt, @updatedAt)
      ON CONFLICT(proxy_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        host = excluded.host,
        port = excluded.port,
        username = excluded.username,
        credential_ref = excluded.credential_ref,
        updated_at = excluded.updated_at
    `)
    this.deleteProxyStatement = sqlite.prepare('DELETE FROM proxies WHERE proxy_id = ?')
    this.getSettingStatement = sqlite.prepare(
      'SELECT value_json FROM app_settings WHERE setting_key = ?',
    )
    this.upsertSettingStatement = sqlite.prepare(`
      INSERT INTO app_settings (setting_key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `)
    this.listKernelInstallationsStatement = sqlite.prepare(
      'SELECT * FROM kernel_installations ORDER BY updated_at DESC',
    )
    this.getKernelInstallationStatement = sqlite.prepare(`
      SELECT * FROM kernel_installations
      WHERE kernel_id = ? AND version = ? AND platform = ? AND arch = ?
      ORDER BY updated_at DESC LIMIT 1
    `)
    this.insertKernelInstallationStatement = sqlite.prepare(`
      INSERT INTO kernel_installations (
        kernel_id, version, platform, arch, source_url, sha256, install_path, state, created_at, updated_at
      ) VALUES (@kernelId, @version, @platform, @arch, @sourceUrl, @sha256, @installPath, @state, @createdAt, @updatedAt)
      ON CONFLICT(kernel_id, version, platform, arch) DO UPDATE SET
        source_url = excluded.source_url,
        sha256 = excluded.sha256,
        install_path = excluded.install_path,
        state = excluded.state,
        updated_at = excluded.updated_at
    `)
  }

  list(): EnvironmentRecord[] {
    return (this.listStatement.all() as Row[]).map(mapEnvironment)
  }

  get(environmentId: string): EnvironmentRecord | undefined {
    const row = this.getStatement.get(environmentId) as Row | undefined
    return row ? mapEnvironment(row) : undefined
  }

  create(input: {
    config: EnvironmentConfig
    dataDir: string
    platform: TargetPlatform
    arch: TargetArchitecture
  }): EnvironmentRecord {
    const now = new Date().toISOString()
    const record: EnvironmentRecord = {
      environmentId: input.config.environmentId,
      name: input.config.name,
      status: 'created',
      kernelId: input.config.kernelId,
      kernelVersion: input.config.kernelVersion,
      proxyId: input.config.proxyId ?? null,
      configJson: JSON.stringify(input.config),
      revision: 1,
      lifecycle: 'active',
      trashedAt: null,
      dataDir: input.dataDir,
      platform: input.platform,
      arch: input.arch,
      createdAt: now,
      updatedAt: now,
    }
    this.transaction(() => {
      const { revision, lifecycle: _lifecycle, trashedAt: _trashedAt, ...insert } = record
      this.insertStatement.run(insert)
      this.sqlite
        .prepare('INSERT INTO environment_revisions VALUES (?, ?, ?, ?)')
        .run(record.environmentId, revision, record.configJson, now)
    })
    return record
  }

  updateStatus(environmentId: string, status: EnvironmentStatus): EnvironmentRecord | undefined {
    const updatedAt = new Date().toISOString()
    this.updateStatusStatement.run(status, updatedAt, environmentId)
    return this.get(environmentId)
  }

  private transactionDepth = 0
  private transaction<T>(run: () => T): T {
    const nested = this.transactionDepth > 0
    const savepoint = `repository_${this.transactionDepth}`
    this.sqlite.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const result = run()
      this.sqlite.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT')
      return result
    } catch (error) {
      try {
        this.sqlite.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK')
        if (nested) this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`)
      } catch (rollbackError) {
        // SQLite may already have rolled back on an I/O error; retain both causes.
        throw new AggregateError([error, rollbackError], 'TRANSACTION_ROLLBACK_FAILED')
      }
      throw error
    } finally {
      this.transactionDepth--
    }
  }

  updateConfig(
    config: EnvironmentConfig,
    expectedRevision?: number,
  ): EnvironmentRecord | undefined {
    const current = this.get(config.environmentId)
    if (!current) return undefined
    return this.transaction(() => {
      const now = new Date().toISOString()
      const json = JSON.stringify(config)
      const result = this.updateConfigStatement.run(
        config.name,
        config.proxyId ?? null,
        json,
        now,
        config.environmentId,
        expectedRevision ?? current.revision,
      )
      if (Number(result.changes) !== 1) throw new Error('CONFIG_CONFLICT')
      this.sqlite
        .prepare('INSERT INTO environment_revisions VALUES (?, ?, ?, ?)')
        .run(config.environmentId, current.revision + 1, json, now)
      return this.get(config.environmentId)
    })
  }

  getRevision(environmentId: string, revision: number): string | undefined {
    const row = this.sqlite
      .prepare(
        'SELECT config_json FROM environment_revisions WHERE environment_id = ? AND revision = ?',
      )
      .get(environmentId, revision)
    return row ? stringValue(row, 'config_json') : undefined
  }

  listAll(): EnvironmentRecord[] {
    return (
      this.sqlite.prepare('SELECT * FROM environments ORDER BY updated_at DESC').all() as Row[]
    ).map(mapEnvironment)
  }

  listTrash(): EnvironmentRecord[] {
    return this.listAll().filter((record) => record.lifecycle === 'trashed')
  }

  // Soft deletion preserves the identity, immutable revisions, history and browser directory.
  deleteEnvironment(environmentId: string): void {
    const now = new Date().toISOString()
    this.sqlite
      .prepare(
        "UPDATE environments SET lifecycle = 'trashed', trashed_at = ?, updated_at = ? WHERE environment_id = ?",
      )
      .run(now, now, environmentId)
  }

  restoreEnvironment(environmentId: string): EnvironmentRecord | undefined {
    this.sqlite
      .prepare(
        "UPDATE environments SET lifecycle = 'active', trashed_at = NULL, updated_at = ? WHERE environment_id = ?",
      )
      .run(new Date().toISOString(), environmentId)
    return this.get(environmentId)
  }

  createOperation(operationId: string, kind: OperationKind, environmentId: string | null): void {
    this.sqlite
      .prepare("INSERT INTO operations VALUES (?, ?, ?, 'running', 'queued', ?, NULL, NULL)")
      .run(operationId, environmentId, kind, new Date().toISOString())
  }

  updateOperation(
    operationId: string,
    phase: string,
    status: OperationSummary['status'] = 'running',
    errorCode: string | null = null,
  ): void {
    this.sqlite
      .prepare(
        'UPDATE operations SET phase = ?, status = ?, ended_at = ?, error_code = ? WHERE operation_id = ?',
      )
      .run(
        phase,
        status,
        status === 'running' ? null : new Date().toISOString(),
        errorCode,
        operationId,
      )
  }

  recoverOperations(): void {
    this.sqlite
      .prepare(
        "UPDATE operations SET status = 'failed', phase = 'interrupted', error_code = 'CLIENT_INTERRUPTED', ended_at = ? WHERE status = 'running'",
      )
      .run(new Date().toISOString())
  }

  listOperations(): OperationSummary[] {
    return this.sqlite
      .prepare('SELECT * FROM operations ORDER BY started_at DESC LIMIT 500')
      .all()
      .map((row) => ({
        operationId: stringValue(row, 'operation_id'),
        environmentId: nullableStringValue(row, 'environment_id'),
        kind: stringValue(row, 'kind') as OperationKind,
        status: stringValue(row, 'status') as OperationSummary['status'],
        phase: stringValue(row, 'phase'),
        startedAt: stringValue(row, 'started_at'),
        endedAt: nullableStringValue(row, 'ended_at'),
        errorCode: nullableStringValue(row, 'error_code'),
      }))
  }

  listRuntimeSessions(): RuntimeSessionRecord[] {
    return (this.listRuntimeSessionsStatement.all() as Row[]).map(mapRuntimeSession)
  }

  getRuntimeSession(sessionId: string): RuntimeSessionRecord | undefined {
    const row = this.getRuntimeSessionStatement.get(sessionId) as Row | undefined
    return row ? mapRuntimeSession(row) : undefined
  }

  createRuntimeSession(input: RuntimeSessionRecord): RuntimeSessionRecord {
    this.insertRuntimeSessionStatement.run({
      ...input,
      endedAt: input.endedAt ?? null,
      processIdentity: input.processIdentity ?? null,
      revision: input.revision ?? null,
      kernelVersion: input.kernelVersion ?? null,
      executableVersion: input.executableVersion ?? null,
      phase: input.phase ?? 'launch',
    })
    return input
  }

  updateRuntimeSession(
    sessionId: string,
    status: RuntimeSession['status'],
    exitReason: string | null = null,
  ): RuntimeSessionRecord | undefined {
    const terminal = status === 'stopped' || status === 'crashed'
    this.updateRuntimeSessionStatement.run(
      status,
      exitReason,
      terminal ? new Date().toISOString() : null,
      terminal ? 'ended' : status,
      sessionId,
    )
    return this.getRuntimeSession(sessionId)
  }

  setRuntimeProcessIdentity(sessionId: string, pid: number, identity: string): boolean {
    const result = this.sqlite
      .prepare(
        "UPDATE runtime_sessions SET process_identity = ? WHERE session_id = ? AND pid = ? AND status = 'starting' AND process_identity IS NULL",
      )
      .run(identity, sessionId, pid)
    return result.changes === 1
  }

  setRuntimeVersion(sessionId: string, version: string): void {
    this.sqlite
      .prepare('UPDATE runtime_sessions SET executable_version = ? WHERE session_id = ?')
      .run(version, sessionId)
  }

  deleteRuntimeSession(sessionId: string): void {
    this.deleteRuntimeSessionStatement.run(sessionId)
  }

  listProxies(): ProxyRecord[] {
    return (this.listProxyStatement.all() as Row[]).map(mapProxy)
  }

  getProxy(proxyId: string): ProxyRecord | undefined {
    const row = this.getProxyStatement.get(proxyId) as Row | undefined
    return row ? mapProxy(row) : undefined
  }

  saveProxy(proxyId: string, config: ProxyConfig): ProxyRecord {
    const now = new Date().toISOString()
    const record: ProxyRecord = {
      proxyId,
      ...config,
      name: config.name?.trim() || `${config.host}:${config.port}`,
      createdAt: this.getProxy(proxyId)?.createdAt ?? now,
      updatedAt: now,
    }
    this.insertProxyStatement.run({
      ...record,
      username: record.username ?? null,
      credentialRef: record.credentialRef ?? null,
    })
    return record
  }

  /** The proxy, current environment snapshots, revisions and retirement journal commit together. */
  saveProxyWithEnvironments(proxyId: string, config: ProxyConfig): ProxyRecord {
    return this.transaction(() => {
      const previous = this.getProxy(proxyId)
      const proxy = this.saveProxy(proxyId, config)
      for (const record of this.listAll()) {
        if (record.proxyId !== proxyId || record.lifecycle !== 'active') continue
        const stored = environmentConfigSchema.parse(JSON.parse(record.configJson))
        if (stored.environmentId !== record.environmentId || stored.proxyId !== proxyId)
          throw new Error('CONFIG_INVALID')
        this.updateConfig(environmentConfigSchema.parse({ ...stored, proxy }), record.revision)
      }
      if (config.credentialRef) this.completeCredentialCleanup(config.credentialRef)
      if (previous?.credentialRef && previous.credentialRef !== config.credentialRef)
        this.scheduleCredentialCleanup(previous.credentialRef)
      return proxy
    })
  }

  deleteProxyWithCleanup(proxyId: string): void {
    this.transaction(() => {
      const previous = this.getProxy(proxyId)
      this.deleteProxy(proxyId)
      if (previous?.credentialRef) this.scheduleCredentialCleanup(previous.credentialRef)
    })
  }

  scheduleCredentialCleanup(reference: string): void {
    this.sqlite
      .prepare('INSERT OR IGNORE INTO credential_cleanup (credential_ref, created_at) VALUES (?, ?)')
      .run(reference, new Date().toISOString())
  }

  completeCredentialCleanup(reference: string): void {
    this.sqlite.prepare('DELETE FROM credential_cleanup WHERE credential_ref = ?').run(reference)
  }

  pendingCredentialCleanup(): string[] {
    return this.sqlite
      .prepare('SELECT credential_ref FROM credential_cleanup ORDER BY created_at, credential_ref')
      .all()
      .map((row) => stringValue(row, 'credential_ref'))
  }

  isCredentialReferenced(reference: string): boolean {
    const proxies = this.listProxies()
    if (proxies.some((proxy) => proxy.credentialRef === reference)) return true
    // Linked snapshots (including trash/history) resolve through the current proxy at use time.
    // Legacy inline configurations remain authoritative and must never lose their credentials.
    return this.listAll().some((record) => {
      const config = environmentConfigSchema.parse(JSON.parse(record.configJson))
      if (
        config.environmentId !== record.environmentId ||
        (config.proxyId ?? null) !== record.proxyId
      )
        throw new Error('CONFIG_INVALID')
      const resolvesThroughProxy =
        config.proxyId && proxies.some((proxy) => proxy.proxyId === config.proxyId)
      return !resolvesThroughProxy && config.proxy?.credentialRef === reference
    })
  }

  deleteProxy(proxyId: string): void {
    this.deleteProxyStatement.run(proxyId)
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.getSettingStatement.get(key) as Row | undefined
    if (!row) return undefined
    return JSON.parse(stringValue(row, 'value_json')) as T
  }

  setSetting<T>(key: string, value: T): void {
    this.upsertSettingStatement.run(key, JSON.stringify(value), new Date().toISOString())
  }

  markKernelRemoving(id: number): void {
    this.sqlite.prepare("UPDATE kernel_installations SET state = 'removing', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id)
  }

  deleteKernelInstallation(id: number): void {
    this.sqlite.prepare('DELETE FROM kernel_installations WHERE id = ?').run(id)
  }

  listKernelInstallations(): KernelInstallationRecord[] {
    return (this.listKernelInstallationsStatement.all() as Row[]).map(mapKernelInstallation)
  }

  getKernelInstallation(
    kernelId: string,
    version: string,
    platform: TargetPlatform,
    arch: TargetArchitecture,
  ): KernelInstallationRecord | undefined {
    const row = this.getKernelInstallationStatement.get(kernelId, version, platform, arch) as
      Row | undefined
    return row ? mapKernelInstallation(row) : undefined
  }

  recordKernelInstallation(
    input: Omit<KernelInstallationRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): KernelInstallationRecord {
    const now = new Date().toISOString()
    const existing = this.getKernelInstallation(
      input.kernelId,
      input.version,
      input.platform,
      input.arch,
    )
    const record = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.insertKernelInstallationStatement.run(record)
    return this.getKernelInstallation(input.kernelId, input.version, input.platform, input.arch)!
  }
}

export {
  acquireRuntimeLock,
  inspectRuntimeLock,
  isProcessAlive,
  isRuntimeProcessAlive,
  readProcessIdentity,
  releaseRuntimeLock,
  runtimeLockPath,
  updateRuntimeLockOwner,
  type RuntimeLockOwner,
  type RuntimeLockResult,
} from './lock'

export { readProcessIdentityAsync } from './process-identity-async'
