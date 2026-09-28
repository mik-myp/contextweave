import type { WorkspaceCredentialReference } from '@contextweave/contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { drainCredentialCleanup, saveProxyConfiguration, toProxySummary } from './proxy-management'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanup.splice(0).reverse()) clean()
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'cw-proxy-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const database = openLocalDatabase(join(directory, 'test.sqlite'))
  cleanup.push(() => database.close())
  const repository = new EnvironmentRepository(database.sqlite)
  const secrets = new Map<string, string>()
  const credentials = {
    save: (key: WorkspaceCredentialReference, value: string) => {
      secrets.set(key.reference, value)
    },
    remove: (key: WorkspaceCredentialReference | undefined) => {
      if (key) secrets.delete(key.reference)
    },
  }
  return { repository, secrets, credentials }
}
const config = { type: 'http', host: '127.0.0.1', port: 8080, username: 'tester' }
describe('proxy credential lifecycle', () => {
  let fixture: ReturnType<typeof setup>
  beforeEach(() => {
    // Prepare the real disk/WAL database, migrations and integrity checks separately
    // from the credential behavior; every test still gets its own database and vault.
    fixture = setup()
  })
  it('creates, preserves, replaces and explicitly clears a secret without returning its reference', () => {
    const { repository, secrets, credentials } = fixture
    const created = saveProxyConfiguration(repository, { config, password: 'first' }, credentials)
    expect(created.hasPassword).toBe(true)
    expect(created).not.toHaveProperty('credentialRef')
    expect(created).not.toHaveProperty('password')
    const reference = repository.getProxy(created.proxyId)!.credentialRef
    const kept = saveProxyConfiguration(
      repository,
      { proxyId: created.proxyId, config: { ...config, name: 'Renamed proxy' } },
      credentials,
    )
    expect(kept.name).toBe('Renamed proxy')
    expect(repository.getProxy(created.proxyId)!.credentialRef).toBe(reference)
    saveProxyConfiguration(
      repository,
      { proxyId: created.proxyId, config, password: 'second' },
      credentials,
    )
    expect([...secrets.values()]).toEqual(['second'])
    const cleared = saveProxyConfiguration(
      repository,
      { proxyId: created.proxyId, config, clearPassword: true },
      credentials,
    )
    expect(cleared.hasPassword).toBe(false)
    expect(secrets.size).toBe(0)
    expect(toProxySummary(repository.getProxy(created.proxyId)!)).toEqual(cleared)
  })
  it('rolls back a new secret when persistence fails, keeping the old password intact', () => {
    const { repository, secrets, credentials } = fixture
    const created = saveProxyConfiguration(repository, { config, password: 'old' }, credentials)
    const save = vi.spyOn(repository, 'saveProxy').mockImplementation(() => {
      throw new Error('Disk full')
    })
    expect(() =>
      saveProxyConfiguration(
        repository,
        { proxyId: created.proxyId, config, password: 'new' },
        credentials,
      ),
    ).toThrow('Disk full')
    expect([...secrets.values()]).toEqual(['old'])
    save.mockRestore()
  })
  it('keeps the committed configuration and retries old credential cleanup without a database rollback', () => {
    const { repository, secrets, credentials } = fixture
    const created = saveProxyConfiguration(repository, { config, password: 'old' }, credentials)
    const oldReference = repository.getProxy(created.proxyId)!.credentialRef!
    saveProxyConfiguration(
      repository,
      { proxyId: created.proxyId, config: { ...config, port: 9090 }, password: 'new' },
      {
        ...credentials,
        remove: () => {
          throw new Error('Credential vault read-only')
        },
      },
    )
    expect(repository.getProxy(created.proxyId)!.port).toBe(9090)
    expect([...secrets.values()]).toEqual(['old', 'new'])
    expect(repository.pendingCredentialCleanup()).toEqual([oldReference])
    expect(drainCredentialCleanup(repository, credentials)).toBe(true)
    expect([...secrets.values()]).toEqual(['new'])
    expect(repository.pendingCredentialCleanup()).toEqual([])
  })

  it('keeps existing data if secure storage is unavailable and rejects stale edits', () => {
    const { repository, credentials } = fixture
    expect(() =>
      saveProxyConfiguration(
        repository,
        { config, password: 'new' },
        {
          ...credentials,
          save: () => {
            throw new Error('Secure storage unavailable')
          },
        },
      ),
    ).toThrow('Secure storage unavailable')
    expect(repository.listProxies()).toHaveLength(0)
    expect(() =>
      saveProxyConfiguration(repository, { proxyId: 'removed', config }, credentials),
    ).toThrow('NOT_FOUND')
  })
})
