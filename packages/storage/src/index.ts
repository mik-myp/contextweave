import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  EnvironmentConfig,
  EnvironmentStatus,
  ProxyConfig,
  RuntimeSession,
  TargetArchitecture,
  TargetPlatform,
} from '@contextweave/contracts'

const migrationSql = `
CREATE TABLE IF NOT EXISTS environments (
  environment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  kernel_id TEXT NOT NULL,
  kernel_version TEXT NOT NULL,
  proxy_id TEXT,
  config_json TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kernel_installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kernel_id TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  source_url TEXT,
  sha256 TEXT,
  install_path TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_sessions (
  session_id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  control_port INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_reason TEXT
);
CREATE TABLE IF NOT EXISTS proxies (
  proxy_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  credential_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_environments_updated_at ON environments(updated_at);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_environment ON runtime_sessions(environment_id);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_status ON runtime_sessions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kernel_installations_identity
  ON kernel_installations(kernel_id, version, platform, arch);
`

type Row = Record<string, unknown>

export type LocalDatabase = {
  sqlite: DatabaseSync
  close: () => void
}

export function openLocalDatabase(filePath: string): LocalDatabase {
  mkdirSync(dirname(filePath), { recursive: true })
  const sqlite = new DatabaseSync(filePath)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  sqlite.exec(migrationSql)
  return { sqlite, close: () => sqlite.close() }
}

export type EnvironmentRecord = {
  environmentId: string
  name: string
  status: EnvironmentStatus
  kernelId: string
  kernelVersion: string
  proxyId: string | null
  configJson: string
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
    controlPort: Number(row.control_port),
    startedAt: stringValue(row, 'started_at'),
    status: stringValue(row, 'status') as RuntimeSession['status'],
    exitReason: nullableStringValue(row, 'exit_reason'),
  }
}

function mapProxy(row: Row): ProxyRecord {
  return {
    proxyId: stringValue(row, 'proxy_id'),
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
  private readonly deleteEnvironmentStatement: StatementSync
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

  constructor(sqlite: DatabaseSync) {
    this.listStatement = sqlite.prepare('SELECT * FROM environments ORDER BY updated_at DESC')
    this.getStatement = sqlite.prepare('SELECT * FROM environments WHERE environment_id = ?')
    this.insertStatement = sqlite.prepare(`
      INSERT INTO environments (
        environment_id, name, status, kernel_id, kernel_version, proxy_id,
        config_json, data_dir, platform, arch, created_at, updated_at
      ) VALUES (@environmentId, @name, @status, @kernelId, @kernelVersion, @proxyId,
        @configJson, @dataDir, @platform, @arch, @createdAt, @updatedAt)
    `)
    this.updateConfigStatement = sqlite.prepare('UPDATE environments SET name = ?, proxy_id = ?, config_json = ?, updated_at = ? WHERE environment_id = ?')
    this.deleteEnvironmentStatement = sqlite.prepare('DELETE FROM environments WHERE environment_id = ?')
    this.updateStatusStatement = sqlite.prepare('UPDATE environments SET status = ?, updated_at = ? WHERE environment_id = ?')
    this.listRuntimeSessionsStatement = sqlite.prepare('SELECT * FROM runtime_sessions ORDER BY started_at DESC')
    this.getRuntimeSessionStatement = sqlite.prepare('SELECT * FROM runtime_sessions WHERE session_id = ?')
    this.insertRuntimeSessionStatement = sqlite.prepare(`
      INSERT INTO runtime_sessions (
        session_id, environment_id, pid, control_port, started_at, status, exit_reason
      ) VALUES (@sessionId, @environmentId, @pid, @controlPort, @startedAt, @status, @exitReason)
    `)
    this.updateRuntimeSessionStatement = sqlite.prepare(`
      UPDATE runtime_sessions SET status = ?, exit_reason = ? WHERE session_id = ?
    `)
    this.deleteRuntimeSessionStatement = sqlite.prepare('DELETE FROM runtime_sessions WHERE session_id = ?')
    this.listProxyStatement = sqlite.prepare('SELECT * FROM proxies ORDER BY updated_at DESC')
    this.getProxyStatement = sqlite.prepare('SELECT * FROM proxies WHERE proxy_id = ?')
    this.insertProxyStatement = sqlite.prepare(`
      INSERT INTO proxies (
        proxy_id, type, host, port, username, credential_ref, created_at, updated_at
      ) VALUES (@proxyId, @type, @host, @port, @username, @credentialRef, @createdAt, @updatedAt)
      ON CONFLICT(proxy_id) DO UPDATE SET
        type = excluded.type,
        host = excluded.host,
        port = excluded.port,
        username = excluded.username,
        credential_ref = excluded.credential_ref,
        updated_at = excluded.updated_at
    `)
    this.deleteProxyStatement = sqlite.prepare('DELETE FROM proxies WHERE proxy_id = ?')
    this.getSettingStatement = sqlite.prepare('SELECT value_json FROM app_settings WHERE setting_key = ?')
    this.upsertSettingStatement = sqlite.prepare(`
      INSERT INTO app_settings (setting_key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `)
    this.listKernelInstallationsStatement = sqlite.prepare('SELECT * FROM kernel_installations ORDER BY updated_at DESC')
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
      dataDir: input.dataDir,
      platform: input.platform,
      arch: input.arch,
      createdAt: now,
      updatedAt: now,
    }
    this.insertStatement.run(record)
    return record
  }

  updateStatus(environmentId: string, status: EnvironmentStatus): EnvironmentRecord | undefined {
    const updatedAt = new Date().toISOString()
    this.updateStatusStatement.run(status, updatedAt, environmentId)
    return this.get(environmentId)
  }

  updateConfig(config: EnvironmentConfig): EnvironmentRecord | undefined {
    this.updateConfigStatement.run(
      config.name,
      config.proxyId ?? null,
      JSON.stringify(config),
      new Date().toISOString(),
      config.environmentId,
    )
    return this.get(config.environmentId)
  }

  // Remove metadata only. The profile and runtime history remain available for manual recovery.
  deleteEnvironment(environmentId: string): void {
    this.deleteEnvironmentStatement.run(environmentId)
  }

  listRuntimeSessions(): RuntimeSessionRecord[] {
    return (this.listRuntimeSessionsStatement.all() as Row[]).map(mapRuntimeSession)
  }

  getRuntimeSession(sessionId: string): RuntimeSessionRecord | undefined {
    const row = this.getRuntimeSessionStatement.get(sessionId) as Row | undefined
    return row ? mapRuntimeSession(row) : undefined
  }

  createRuntimeSession(input: RuntimeSessionRecord): RuntimeSessionRecord {
    this.insertRuntimeSessionStatement.run(input)
    return input
  }

  updateRuntimeSession(
    sessionId: string,
    status: RuntimeSession['status'],
    exitReason: string | null = null,
  ): RuntimeSessionRecord | undefined {
    this.updateRuntimeSessionStatement.run(status, exitReason, sessionId)
    return this.getRuntimeSession(sessionId)
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
      createdAt: this.getProxy(proxyId)?.createdAt ?? now,
      updatedAt: now,
    }
    this.insertProxyStatement.run({ ...record, username: record.username ?? null, credentialRef: record.credentialRef ?? null })
    return record
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

  listKernelInstallations(): KernelInstallationRecord[] {
    return (this.listKernelInstallationsStatement.all() as Row[]).map(mapKernelInstallation)
  }

  getKernelInstallation(
    kernelId: string,
    version: string,
    platform: TargetPlatform,
    arch: TargetArchitecture,
  ): KernelInstallationRecord | undefined {
    const row = this.getKernelInstallationStatement.get(kernelId, version, platform, arch) as Row | undefined
    return row ? mapKernelInstallation(row) : undefined
  }

  recordKernelInstallation(input: Omit<KernelInstallationRecord, 'id' | 'createdAt' | 'updatedAt'>): KernelInstallationRecord {
    const now = new Date().toISOString()
    const existing = this.getKernelInstallation(input.kernelId, input.version, input.platform, input.arch)
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
  releaseRuntimeLock,
  runtimeLockPath,
  updateRuntimeLockOwner,
  type RuntimeLockOwner,
  type RuntimeLockResult,
} from './lock'
