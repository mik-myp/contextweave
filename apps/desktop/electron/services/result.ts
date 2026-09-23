import type { EnvironmentSummary, IpcResult } from '@contextweave/contracts'
import type { EnvironmentRecord } from '@contextweave/storage'
export const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })
export const fail = (code: string, message = code): IpcResult<never> => ({
  ok: false,
  code,
  message,
})
export function toSummary(record: EnvironmentRecord): EnvironmentSummary {
  return {
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
  }
}
