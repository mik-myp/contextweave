import { existsSync } from 'node:fs'
import {
  environmentConfigSchema,
  environmentDetailsSchema,
  environmentIdSchema,
  updateEnvironmentInputSchema,
  type EnvironmentConfig,
  type EnvironmentDetails,
} from '@contextweave/contracts'
import {
  inspectRuntimeLock,
  isProcessAlive,
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
        isProcessAlive(session.pid),
    )
  if (
    ['starting', 'running', 'stopping', 'needs-recovery'].includes(record.status) ||
    existsSync(lock.lockPath) ||
    active
  ) {
    throw new Error('请先停止浏览器并完成环境恢复，再修改或删除环境。')
  }
}

export function resolveEnvironmentProxy(
  repository: EnvironmentRepository,
  config: EnvironmentConfig,
): EnvironmentConfig {
  if (!config.proxyId) return config
  const proxy = repository.getProxy(config.proxyId)
  if (!proxy) throw new Error('绑定的代理已不存在，请重新选择代理。')
  return environmentConfigSchema.parse({ ...config, proxy })
}

export function updateEnvironment(
  repository: EnvironmentRepository,
  input: unknown,
): EnvironmentRecord {
  const parsed = updateEnvironmentInputSchema.parse(input)
  const record = repository.get(parsed.environmentId)
  if (!record) throw new Error('环境已不存在，请刷新列表。')
  assertEnvironmentEditable(repository, record)
  const config = environmentConfigSchema.parse(JSON.parse(record.configJson))
  const next = resolveEnvironmentProxy(repository, {
    ...config,
    name: parsed.name,
    commonConfig: { ...config.commonConfig, ...parsed.browserSettings },
    proxyId: parsed.proxyId ?? undefined,
    proxy: undefined,
  })
  return repository.updateConfig(next)!
}

export function removeEnvironment(repository: EnvironmentRepository, id: unknown): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('环境 ID 无效。')
  const record = repository.get(id)
  if (!record) throw new Error('环境已不存在，请刷新列表。')
  assertEnvironmentEditable(repository, record)
  repository.deleteEnvironment(id)
}

export function assertProxyMutable(
  repository: EnvironmentRepository,
  proxyId: string,
  deleting: boolean,
): void {
  const references = repository.list().filter((record) => record.proxyId === proxyId)
  if (deleting && references.length) {
    throw new Error(`此代理被 ${references.length} 个环境使用，请先在环境编辑中解除绑定。`)
  }
  for (const record of references) assertEnvironmentEditable(repository, record)
}

export function getEnvironmentDetails(
  repository: EnvironmentRepository,
  id: unknown,
): EnvironmentDetails {
  const record = repository.get(environmentIdSchema.parse(id))
  if (!record) throw new Error('环境已不存在。')
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
    browserSettings: {
      language: config.commonConfig.language,
      timezone: config.commonConfig.timezone,
      window: config.commonConfig.window,
    },
  })
}
