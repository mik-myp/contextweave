import { randomUUID } from 'node:crypto'
import {
  proxySummarySchema,
  proxyTestInputSchema,
  saveProxyInputSchema,
  type ProxyConfig,
} from '@contextweave/contracts'
import type { EnvironmentRepository, ProxyRecord } from '@contextweave/storage'
import { assertProxyMutable } from './environment-management'

type Credentials = {
  save: (reference: string, password: string) => void
  remove: (reference: string | undefined) => void
}
export function toProxySummary(record: ProxyRecord) {
  return proxySummarySchema.parse({ ...record, hasPassword: Boolean(record.credentialRef) })
}

function assertCredentialTarget(previous: ProxyRecord, next: ProxyConfig): void {
  if (
    previous.type !== next.type ||
    previous.host.toLowerCase() !== next.host.toLowerCase() ||
    previous.port !== next.port ||
    previous.username !== next.username
  ) {
    throw new Error('PROXY_CREDENTIAL_TARGET_CHANGED')
  }
}

export function resolveProxyTestConfiguration(
  repository: Pick<EnvironmentRepository, 'getProxy'>,
  input: unknown,
  credentials: { read(reference: string): string | undefined },
): { config: ProxyConfig; password: string } {
  const parsed = proxyTestInputSchema.parse(input)
  const saved = parsed.proxyId ? repository.getProxy(parsed.proxyId) : undefined
  if (parsed.proxyId && !saved) throw new Error('NOT_FOUND')
  const config = 'config' in parsed ? parsed.config : saved
  if (!config) throw new Error('NOT_FOUND')
  if ('config' in parsed && parsed.password) return { config, password: parsed.password }
  if (
    config.username &&
    saved?.credentialRef &&
    !('clearPassword' in parsed && parsed.clearPassword)
  ) {
    // Check the complete connection identity before even decrypting the saved secret.
    assertCredentialTarget(saved, config)
    const password = credentials.read(saved.credentialRef)
    if (password === undefined) throw new Error('CREDENTIAL_UNAVAILABLE')
    return { config, password }
  }
  return { config, password: '' }
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
  if (previous?.credentialRef && !shouldClear && !parsed.password) {
    // Saving first must not bypass the same target binding enforced by proxy:test.
    assertCredentialTarget(previous, parsed.config)
  }
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
