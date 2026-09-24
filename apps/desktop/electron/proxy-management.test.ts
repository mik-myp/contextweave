import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { drainCredentialCleanup, saveProxyConfiguration, toProxySummary } from './proxy-management'
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'cw-proxy-'))
  directories.push(directory)
  const database = openLocalDatabase(join(directory, 'test.sqlite'))
  const repository = new EnvironmentRepository(database.sqlite)
  const secrets = new Map<string, string>()
  const credentials = {
    save: (key: string, value: string) => {
      secrets.set(key, value)
    },
    remove: (key: string | undefined) => {
      if (key) secrets.delete(key)
    },
  }
  return { database, repository, secrets, credentials }
}
const config = { type: 'http', host: '127.0.0.1', port: 8080, username: 'tester' }
describe('proxy credential lifecycle', () => {
  it('creates, preserves, replaces and explicitly clears a secret without returning its reference', () => {
    const { database, repository, secrets, credentials } = setup()
    try {
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
    } finally {
      database.close()
    }
  })
  it('rolls back a new secret when persistence fails, keeping the old password intact', () => {
    const { database, repository, secrets, credentials } = setup()
    try {
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
    } finally {
      database.close()
    }
  })
  it('keeps the committed configuration and retries old credential cleanup without a database rollback', () => {
    const { database, repository, secrets, credentials } = setup()
    try {
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
    } finally {
      database.close()
    }
  })

  it('keeps existing data if secure storage is unavailable and rejects stale edits', () => {
    const { database, repository, credentials } = setup()
    try {
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
    } finally {
      database.close()
    }
  })
})
