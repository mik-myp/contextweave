import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, statfs, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import {
  environmentConfigSchema,
  type PreflightReport,
  type PreflightIssue,
} from '@contextweave/contracts'
import {
  inspectRuntimeLock,
  type EnvironmentRecord,
  type EnvironmentRepository,
} from '@contextweave/storage'
import { resolveEnvironmentProxy } from '../environment-management'
import type { CredentialStore } from './credentials'
import { readExecutableVersion, type KernelService } from './kernel-service'

export function checkProxyConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: host.replace(/^\[|\]$/g, ''), port })
    const finish = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(1800, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
export async function checkEnvironment(
  record: EnvironmentRecord,
  repository: EnvironmentRepository,
  kernels: KernelService,
  credentials: Pick<CredentialStore, 'read'>,
): Promise<PreflightReport> {
  const issues: PreflightIssue[] = []
  const add = (code: PreflightIssue['code'], severity: PreflightIssue['severity'] = 'error') =>
    issues.push({ code, severity })
  if (record.lifecycle === 'trashed') add('ENVIRONMENT_TRASHED')
  if (record.platform !== process.platform || record.arch !== process.arch) add('PLATFORM_MISMATCH')
  if (record.status === 'needs-recovery') add('RECOVERY_REQUIRED')
  const lock = inspectRuntimeLock(record.dataDir)
  if (existsSync(lock.lockPath)) add(lock.live ? 'RUNTIME_BUSY' : 'RECOVERY_REQUIRED')
  if (['starting', 'running', 'stopping'].includes(record.status) && !existsSync(lock.lockPath))
    add('RUNTIME_BUSY')
  if (record.kernelId === 'standard-chromium') add('NATIVE_MODE', 'info')
  if (!kernels.hasCompatibleProvider(record)) add('PROVIDER_UNVERIFIED')
  let executableVersion: string | undefined
  const executable = kernels.executableFor(record)
  if (!executable) add('KERNEL_UNAVAILABLE')
  else {
    executableVersion = await readExecutableVersion(executable)
    const previousVersion = repository
      .listRuntimeSessions()
      .find(
        (session) => session.environmentId === record.environmentId && session.executableVersion,
      )?.executableVersion
    if (previousVersion && executableVersion && previousVersion !== executableVersion)
      add('VERSION_CHANGED', 'warning')
  }
  try {
    const stored = environmentConfigSchema.parse(JSON.parse(record.configJson))
    if (stored.proxyId && !repository.getProxy(stored.proxyId)) add('PROXY_MISSING')
    else {
      const config = resolveEnvironmentProxy(repository, stored)
      if (!kernels.registry.get(record.kernelId).validateConfig(config.kernelConfig).ok)
        add('CONFIG_INVALID')
      // Legacy hidden flags must not silently appear applied by the native provider.
      if (config.commonConfig.webRtcPolicy === 'disable') add('LEGACY_SETTINGS_UNSUPPORTED')
      if (config.proxy?.credentialRef) {
        try {
          if (credentials.read(config.proxy.credentialRef) === undefined)
            add('CREDENTIAL_UNAVAILABLE')
        } catch {
          add('CREDENTIAL_UNAVAILABLE')
        }
      }
      if (config.proxy && !(await checkProxyConnection(config.proxy.host, config.proxy.port)))
        add('PROXY_UNREACHABLE')
    }
  } catch {
    add('CONFIG_INVALID')
  }
  const probePath = join(record.dataDir, `.write-probe-${randomUUID()}`)
  try {
    const file = await open(probePath, 'wx', 0o600)
    await file.close()
    await unlink(probePath)
    const space = await statfs(record.dataDir)
    if (space.bavail * space.bsize < 64 * 1024 * 1024) add('LOW_DISK')
  } catch {
    add('DIRECTORY_UNWRITABLE')
  }
  return {
    environmentId: record.environmentId,
    revision: record.revision,
    checkedAt: new Date().toISOString(),
    executableVersion,
    canStart: !issues.some((issue) => issue.severity === 'error'),
    issues,
  }
}
