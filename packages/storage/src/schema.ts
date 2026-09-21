import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const environments = sqliteTable('environments', {
  environmentId: text('environment_id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  kernelId: text('kernel_id').notNull(),
  kernelVersion: text('kernel_version').notNull(),
  proxyId: text('proxy_id'),
  configJson: text('config_json').notNull(),
  dataDir: text('data_dir').notNull(),
  platform: text('platform').notNull(),
  arch: text('arch').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const kernelInstallations = sqliteTable('kernel_installations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kernelId: text('kernel_id').notNull(),
  version: text('version').notNull(),
  platform: text('platform').notNull(),
  arch: text('arch').notNull(),
  sourceUrl: text('source_url'),
  sha256: text('sha256'),
  installPath: text('install_path').notNull(),
  state: text('state').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  identity: uniqueIndex('idx_kernel_installations_identity').on(
    table.kernelId,
    table.version,
    table.platform,
    table.arch,
  ),
}))

export const runtimeSessions = sqliteTable('runtime_sessions', {
  sessionId: text('session_id').primaryKey(),
  environmentId: text('environment_id').notNull(),
  pid: integer('pid').notNull(),
  controlPort: integer('control_port').notNull(),
  startedAt: text('started_at').notNull(),
  status: text('status').notNull(),
  exitReason: text('exit_reason'),
})

export const proxies = sqliteTable('proxies', {
  proxyId: text('proxy_id').primaryKey(),
  type: text('type').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username'),
  credentialRef: text('credential_ref'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const appSettings = sqliteTable('app_settings', {
  settingKey: text('setting_key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const schema = { environments, kernelInstallations, runtimeSessions, proxies, appSettings }
