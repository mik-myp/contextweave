import { isFingerprintKernel } from '@contextweave/kernel-fingerprint-chromium'
import { existsSync } from 'node:fs'
import {
  environmentConfigSchema,
  fingerprintIdentitySchema,
  environmentDetailsSchema,
  environmentIdSchema,
  updateEnvironmentInputSchema,
  type EnvironmentConfig,
  type EnvironmentDetails,
} from '@contextweave/contracts'
import {
  inspectRuntimeLock,
  isRuntimeProcessAlive,
  type EnvironmentRecord,
  type EnvironmentRepository,
} from '@contextweave/storage'

export function assertEnvironmentEditable(
  repository: EnvironmentRepository,
  record: EnvironmentRecord,
): void {
  const lock = inspectRuntimeLock(record.dataDir)
  const active = repository
    .listRuntimeSessions()
    .some(
      (session) =>
        session.environmentId === record.environmentId &&
        ['starting', 'running', 'stopping'].includes(session.status) &&
        isRuntimeProcessAlive(session.pid, session.processIdentity),
    )
  if (
    ['starting', 'running', 'stopping', 'needs-recovery'].includes(record.status) ||
    existsSync(lock.lockPath) ||
    active
  ) {
    throw new Error('ENVIRONMENT_BUSY')
  }
}

export function resolveEnvironmentProxy(
  repository: EnvironmentRepository,
  config: EnvironmentConfig,
): EnvironmentConfig {
  if (!config.proxyId) return config
  const proxy = repository.getProxy(config.proxyId)
  if (!proxy) throw new Error('PROXY_MISSING')
  return environmentConfigSchema.parse({ ...config, proxy })
}

export function updateEnvironment(
  repository: EnvironmentRepository,
  input: unknown,
): EnvironmentRecord {
  const parsed = updateEnvironmentInputSchema.parse(input)
  const record = repository.get(parsed.environmentId)
  if (!record || record.lifecycle === 'trashed') throw new Error('NOT_FOUND')
  assertEnvironmentEditable(repository, record)
  const config = environmentConfigSchema.parse(JSON.parse(record.configJson))
  const next = resolveEnvironmentProxy(repository, {
    ...config,
    name: parsed.name,
    commonConfig: { ...config.commonConfig, ...parsed.browserSettings },
    proxyId: parsed.proxyId ?? undefined,
    proxy: undefined,
  })
  return repository.updateConfig(next, parsed.expectedRevision)!
}

export function removeEnvironment(repository: EnvironmentRepository, id: unknown): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('环境 ID 无效。')
  const record = repository.get(id)
  if (!record || record.lifecycle === 'trashed') throw new Error('NOT_FOUND')
  assertEnvironmentEditable(repository, record)
  repository.deleteEnvironment(id)
}

export function assertProxyMutable(
  repository: EnvironmentRepository,
  proxyId: string,
  deleting: boolean,
): void {
  const references = repository.listAll().filter((record) => record.proxyId === proxyId)
  if (deleting && references.length) {
    throw new Error('PROXY_IN_USE')
  }
  for (const record of references) assertEnvironmentEditable(repository, record)
}

export function getEnvironmentDetails(
  repository: EnvironmentRepository,
  id: unknown,
): EnvironmentDetails {
  const record = repository.get(environmentIdSchema.parse(id))
  if (!record) throw new Error('NOT_FOUND')
  if (record.lifecycle === 'trashed') throw new Error('ENVIRONMENT_TRASHED')
  const config = environmentConfigSchema.parse(JSON.parse(record.configJson))
  return environmentDetailsSchema.parse({
    id: record.environmentId,
    name: record.name,
    status: record.status,
    kernelId: record.kernelId,
    kernelVersion: record.kernelVersion,
    proxyId: record.proxyId ?? undefined,
    platform: record.platform,
    arch: record.arch,
    updatedAt: record.updatedAt,
    revision: record.revision,
    lifecycle: record.lifecycle,
    trashedAt: record.trashedAt,
    fingerprint: isFingerprintKernel(record.kernelId)
      ? fingerprintIdentitySchema.safeParse(config.kernelConfig).data
      : undefined,
    browserSettings: {
      language: config.commonConfig.language,
      timezone: config.commonConfig.timezone,
      window: config.commonConfig.window,
    },
  })
}
