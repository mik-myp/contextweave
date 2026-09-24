import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'
import { createCredentialStore } from './services/credentials'
import {
  deleteProxyConfiguration,
  drainCredentialCleanup,
  saveProxyConfiguration,
} from './proxy-management'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const config = {
  type: 'http' as const,
  host: 'proxy.example.test',
  port: 8080,
  username: 'fixture',
}
const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-credential-recovery-'))
  const file = join(root, 'test.sqlite')
  let database = openLocalDatabase(file)
  let repository = new EnvironmentRepository(database.sqlite)
  const credentials = createCredentialStore(join(root, 'credentials.json'), secure)
  cleanups.push(() => {
    database.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    credentials,
    get repository() {
      return repository
    },
    get database() {
      return database
    },
    restart() {
      database.close()
      database = openLocalDatabase(file)
      repository = new EnvironmentRepository(database.sqlite)
      const app = createApplication({
        repository,
        dataRoot: root,
        platform: 'darwin',
        arch: 'arm64',
        secure,
        workerPath: join(root, 'unused.js'),
        changed: () => {},
      })
      cleanups.push(() => app.shutdown())
      return app
    },
  }
}

describe('durable credential retirement', () => {
  it('reports failed temporary-file maintenance and recovers through the retry IPC', async () => {
    const f = fixture()
    const blocked = join(f.root, 'credentials.json.00000000-0000-4000-8000-000000000001.tmp')
    // Maintenance is deliberately nonrecursive, even for a matching filename.
    mkdirSync(blocked)
    const app = f.restart()
    expect(await app.invoke('proxy:cleanup-status')).toEqual({
      ok: true,
      data: { pendingCount: 0, temporaryFilesPending: true },
    })
    rmSync(blocked, { recursive: true })
    expect(await app.invoke('proxy:retry-cleanup')).toEqual({
      ok: true,
      data: { pendingCount: 0, temporaryFilesPending: false },
    })
  })

  it.each(['before-write', 'before-commit', 'after-commit'] as const)(
    'recovers on restart after interruption %s',
    async (phase) => {
      const f = fixture()
      saveProxyConfiguration(
        f.repository,
        { proxyId: undefined, config, password: 'old' },
        f.credentials,
      )
      const previous = f.repository.listProxies()[0]!
      f.repository.scheduleCredentialCleanup('new-reference')
      if (phase !== 'before-write') f.credentials.save('new-reference', 'new')
      if (phase === 'after-commit')
        f.repository.saveProxyWithEnvironments(previous.proxyId, {
          ...config,
          credentialRef: 'new-reference',
        })
      const app = f.restart()
      const expected = phase === 'after-commit' ? 'new-reference' : previous.credentialRef!
      expect(f.repository.listProxies()[0]?.credentialRef).toBe(expected)
      expect(
        Object.keys(JSON.parse(readFileSync(join(f.root, 'credentials.json'), 'utf8'))),
      ).toEqual([expected])
      expect(await app.invoke('proxy:cleanup-status')).toEqual({
        ok: true,
        data: { pendingCount: 0, temporaryFilesPending: false },
      })
    },
  )
  it('retries idempotently when the secret was removed but the journal delete failed', () => {
    const f = fixture()
    f.credentials.save('retired', 'old')
    f.repository.scheduleCredentialCleanup('retired')
    const failure = vi.spyOn(f.repository, 'completeCredentialCleanup').mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(drainCredentialCleanup(f.repository, f.credentials)).toBe(false)
    expect(f.credentials.read('retired')).toBeUndefined()
    expect(f.repository.pendingCredentialCleanup()).toEqual(['retired'])
    failure.mockRestore()
    expect(drainCredentialCleanup(f.repository, f.credentials)).toBe(true)
    expect(f.repository.pendingCredentialCleanup()).toEqual([])
  })
  it('does not delete a secret before proxy deletion commits, and persists failed post-delete cleanup', async () => {
    const f = fixture()
    const saved = saveProxyConfiguration(
      f.repository,
      { config, password: 'secret' },
      f.credentials,
    )
    const previous = f.repository.getProxy(saved.proxyId)!
    f.database.sqlite.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON proxies BEGIN SELECT RAISE(ABORT, 'injected'); END;",
    )
    expect(() => deleteProxyConfiguration(f.repository, saved.proxyId, f.credentials)).toThrow(
      'injected',
    )
    expect(f.repository.getProxy(saved.proxyId)).toEqual(previous)
    expect(f.credentials.read(previous.credentialRef!)).toBe('secret')
    expect(f.repository.pendingCredentialCleanup()).toEqual([])
    f.database.sqlite.exec('DROP TRIGGER fail_delete')
    deleteProxyConfiguration(f.repository, saved.proxyId, {
      ...f.credentials,
      remove: () => {
        throw new Error('vault read-only')
      },
    })
    expect(f.repository.getProxy(saved.proxyId)).toBeUndefined()
    expect(f.repository.pendingCredentialCleanup()).toEqual([previous.credentialRef])
    const app = f.restart()
    expect((await app.invoke('proxy:cleanup-status')).ok).toBe(true)
    expect(f.credentials.read(previous.credentialRef!)).toBeUndefined()
    expect(f.repository.pendingCredentialCleanup()).toEqual([])
  })
  it.each([
    'shared-proxy',
    'inline',
    'trash-inline',
    'dangling-proxy',
    'invalid-config',
    'mismatched-link',
  ] as const)('retains a queued secret if ownership is unsafe to discard: %s', (owner) => {
    const f = fixture()
    f.credentials.save('shared', 'secret')
    f.repository.scheduleCredentialCleanup('shared')
    if (owner === 'shared-proxy')
      f.repository.saveProxy('shared-proxy', { ...config, credentialRef: 'shared' })
    else {
      const environment = environmentConfigSchema.parse({
        environmentId: 'env-owner',
        name: 'Owner',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
        proxyId: owner === 'dangling-proxy' ? 'missing-proxy' : undefined,
        proxy: { ...config, credentialRef: 'shared' },
      })
      f.repository.create({
        config: environment,
        dataDir: join(f.root, 'profile'),
        platform: 'darwin',
        arch: 'arm64',
      })
      if (owner === 'trash-inline') f.repository.deleteEnvironment('env-owner')
      if (owner === 'invalid-config')
        f.database.sqlite.exec("UPDATE environments SET config_json = '{broken'")
      if (owner === 'mismatched-link')
        f.database.sqlite.exec("UPDATE environments SET proxy_id = 'unexpected'")
    }
    expect(drainCredentialCleanup(f.repository, f.credentials)).toBe(false)
    expect(f.credentials.read('shared')).toBe('secret')
    expect(f.repository.pendingCredentialCleanup()).toEqual(['shared'])
  })
  it('does not touch the vault when the cleanup intent cannot be persisted', () => {
    const f = fixture()
    const save = vi.spyOn(f.credentials, 'save')
    f.database.sqlite.exec(
      "CREATE TRIGGER fail_intent BEFORE INSERT ON credential_cleanup BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
    )
    expect(() =>
      saveProxyConfiguration(f.repository, { config, password: 'new' }, f.credentials),
    ).toThrow('disk full')
    expect(save).not.toHaveBeenCalled()
    expect(f.repository.listProxies()).toEqual([])
  })
})
