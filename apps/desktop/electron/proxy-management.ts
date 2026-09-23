import { randomUUID } from 'node:crypto'
import { proxySummarySchema, saveProxyInputSchema } from '@contextweave/contracts'
import type { EnvironmentRepository, ProxyRecord } from '@contextweave/storage'
import { assertProxyMutable } from './environment-management'

type Credentials = {
  save: (reference: string, password: string) => void
  remove: (reference: string | undefined) => void
}
export function toProxySummary(record: ProxyRecord) {
  return proxySummarySchema.parse({ ...record, hasPassword: Boolean(record.credentialRef) })
}

export function saveProxyConfiguration(
  repository: EnvironmentRepository,
  input: unknown,
  credentials: Credentials,
) {
  const parsed = saveProxyInputSchema.parse(input)
  const proxyId = parsed.proxyId ?? `proxy-${randomUUID()}`
  const previous = parsed.proxyId ? repository.getProxy(proxyId) : undefined
  if (parsed.proxyId && !previous) throw new Error('代理已不存在，请刷新列表。')
  if (previous) assertProxyMutable(repository, proxyId, false)
  const shouldClear = parsed.clearPassword || !parsed.config.username
  let credentialRef = shouldClear ? undefined : previous?.credentialRef
  let newReference: string | undefined
  if (parsed.password) {
    // Write a new secret first, so a database failure never overwrites the previous credential.
    newReference = `proxy:${proxyId}:${randomUUID()}`
    credentials.save(newReference, parsed.password)
    credentialRef = newReference
  }
  let record: ProxyRecord
  try {
    record = repository.saveProxy(proxyId, { ...parsed.config, credentialRef })
  } catch (error) {
    if (newReference) credentials.remove(newReference)
    throw error
  }
  if (previous?.credentialRef && previous.credentialRef !== credentialRef) {
    try {
      credentials.remove(previous.credentialRef)
    } catch (error) {
      // Keep the old configuration usable if its credential could not be removed.
      repository.saveProxy(proxyId, previous)
      if (newReference) credentials.remove(newReference)
      throw error
    }
  }
  return toProxySummary(record)
}
