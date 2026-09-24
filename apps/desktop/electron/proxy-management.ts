import { randomUUID } from 'node:crypto'
import {
  proxySummarySchema,
  importProxiesInputSchema,
  importProxiesResultSchema,
  parseProxyLine,
  type ImportProxiesResult,
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
  if (parsed.proxyId && !previous) throw new Error('NOT_FOUND')
  if (previous) assertProxyMutable(repository, proxyId, false)
  const shouldClear = parsed.clearPassword || !parsed.config.username
  if (previous?.credentialRef && !shouldClear && !parsed.password) {
    // Saving first must not bypass the same target binding enforced by proxy:test.
    assertCredentialTarget(previous, parsed.config)
  }
  const newReference = parsed.password ? `proxy:${proxyId}:${randomUUID()}` : undefined
  const credentialRef = newReference ?? (shouldClear ? undefined : previous?.credentialRef)
  // Persist the intent before touching the credential file, so a crash can be recovered.
  if (newReference) repository.scheduleCredentialCleanup(newReference)
  try {
    if (newReference && parsed.password) credentials.save(newReference, parsed.password)
    return toProxySummary(
      repository.saveProxyWithEnvironments(proxyId, { ...parsed.config, credentialRef }),
    )
  } finally {
    drainCredentialCleanup(repository, credentials)
  }
}

/** Cleanup is maintenance, never a compensating database rewrite after a successful commit. */
export function drainCredentialCleanup(
  repository: EnvironmentRepository,
  credentials: Pick<Credentials, 'remove'>,
): boolean {
  try {
    let complete = true
    for (const reference of repository.pendingCredentialCleanup()) {
      try {
        if (repository.isCredentialReferenced(reference)) {
          complete = false
          continue
        }
        credentials.remove(reference)
        repository.completeCredentialCleanup(reference)
      } catch {
        // The durable row remains visible through the maintenance status and can be retried.
        complete = false
      }
    }
    return complete
  } catch {
    // A storage read failure must not trigger blind deletion or undo committed business data.
    return false
  }
}

export function deleteProxyConfiguration(
  repository: EnvironmentRepository,
  proxyId: string,
  credentials: Credentials,
) {
  if (!repository.getProxy(proxyId)) throw new Error('NOT_FOUND')
  assertProxyMutable(repository, proxyId, true)
  try {
    repository.deleteProxyWithCleanup(proxyId)
  } finally {
    drainCredentialCleanup(repository, credentials)
  }
}

/** The bounded batch is owned by Main; closing the dialog does not interrupt committed rows. */
export function importProxyConfigurations(
  repository: EnvironmentRepository,
  input: unknown,
  credentials: Credentials,
) {
  const parsed = importProxiesInputSchema.parse(input)
  const identity = (proxy: ProxyConfig) =>
    JSON.stringify([proxy.type, proxy.host.toLowerCase(), proxy.port, proxy.username ?? ''])
  const existing = new Set(repository.listProxies().map(identity))
  const results: ImportProxiesResult = []
  for (const [index, line] of parsed.text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let config: ReturnType<typeof parseProxyLine>
    try {
      config = parseProxyLine(line, parsed.defaultType)
    } catch {
      results.push({ line: index + 1, status: 'error', code: 'INVALID_PROXY_LINE' })
      continue
    }
    const key = identity(config.config)
    if (existing.has(key)) {
      results.push({ line: index + 1, status: 'skipped', code: 'PROXY_ALREADY_EXISTS' })
      continue
    }
    try {
      const saved = saveProxyConfiguration(repository, config, credentials)
      existing.add(key)
      results.push({ line: index + 1, status: 'created', proxyId: saved.proxyId })
    } catch (error) {
      results.push({
        line: index + 1,
        status: 'error',
        code:
          error instanceof Error && error.message === 'CREDENTIAL_UNAVAILABLE'
            ? 'CREDENTIAL_UNAVAILABLE'
            : 'PROXY_SAVE_FAILED',
      })
    }
  }
  return importProxiesResultSchema.parse(results)
}
