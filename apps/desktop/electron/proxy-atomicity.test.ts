import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { environmentConfigSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'
import { resolveEnvironmentProxy } from './environment-management'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
const config = { type: 'http' as const, host: '127.0.0.1', port: 8080, username: 'fixture' }
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-proxy-atomic-'))
  const db = openLocalDatabase(join(root, 'test.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  }
  const app = createApplication({
    repository,
    dataRoot: root,
    platform: 'darwin',
    arch: 'arm64',
    workerPath: join(root, 'unused.js'),
    changed: () => {},
    secure,
  })
  cleanups.push(async () => {
    await app.shutdown()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  expect((await app.invoke('proxy:save', { config, password: 'old-fixture-secret' })).ok).toBe(true)
  const proxy = repository.listProxies()[0]!
  for (const environmentId of ['env-a', 'env-b', 'env-trash']) {
    repository.create({
      config: environmentConfigSchema.parse({
        environmentId,
        name: environmentId,
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: {},
        proxyId: proxy.proxyId,
        proxy,
      }),
      dataDir: join(root, environmentId),
      platform: 'darwin',
      arch: 'arm64',
    })
  }
  repository.deleteEnvironment('env-trash')
  // listAll sorts by updated_at DESC: always fail after env-a has been written.
  db.sqlite.exec(
    "UPDATE environments SET updated_at = CASE environment_id WHEN 'env-a' THEN '2026-01-03' WHEN 'env-b' THEN '2026-01-02' ELSE '2026-01-01' END",
  )
  const snapshot = () => ({
    proxies: repository.listProxies(),
    environments: repository.listAll(),
    revisions: db.sqlite
      .prepare('SELECT * FROM environment_revisions ORDER BY environment_id, revision')
      .all(),
    secrets: JSON.parse(readFileSync(join(root, 'credentials.json'), 'utf8')),
  })
  return { app, db, repository, proxy, snapshot, secure }
}
describe('proxy command atomicity', () => {
  it.each([
    'BEFORE UPDATE ON proxies',
    "BEFORE UPDATE ON environments WHEN new.environment_id = 'env-a'",
    "BEFORE UPDATE ON environments WHEN new.environment_id = 'env-b'",
    "BEFORE INSERT ON environment_revisions WHEN new.environment_id = 'env-b'",
    'BEFORE DELETE ON credential_cleanup',
  ])('rolls back the complete save and can retry after %s fails', async (trigger) => {
    const { app, db, proxy, snapshot } = await fixture()
    const before = snapshot()
    db.sqlite.exec(
      `CREATE TRIGGER fail_write ${trigger} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`,
    )
    const input = {
      proxyId: proxy.proxyId,
      config: { ...config, port: 9090 },
      password: 'new-fixture-secret',
    }
    expect((await app.invoke('proxy:save', input)).ok).toBe(false)
    expect(snapshot()).toEqual(before)
    db.sqlite.exec('DROP TRIGGER fail_write')
    expect((await app.invoke('proxy:save', input)).ok).toBe(true)
    expect(await app.invoke('proxy:cleanup-status')).toEqual({
      ok: true,
      data: { pendingCount: 0, temporaryFilesPending: false },
    })
  })
  it('rolls back a failed COMMIT, including released nested savepoints, then allows retry', async () => {
    const { app, db, proxy, snapshot } = await fixture()
    const before = snapshot()
    const exec = db.sqlite.exec.bind(db.sqlite)
    const injected = vi.spyOn(db.sqlite, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT') throw new Error('injected commit failure')
      return exec(sql)
    })
    const input = {
      proxyId: proxy.proxyId,
      config: { ...config, port: 9090 },
      password: 'new-fixture-secret',
    }
    expect((await app.invoke('proxy:save', input)).ok).toBe(false)
    expect(snapshot()).toEqual(before)
    injected.mockRestore()
    expect((await app.invoke('proxy:save', input)).ok).toBe(true)
  })
  it('does not change business data when encryption is unavailable', async () => {
    const { app, proxy, snapshot, secure } = await fixture()
    const before = snapshot()
    vi.spyOn(secure, 'isEncryptionAvailable').mockReturnValue(false)
    expect(
      await app.invoke('proxy:save', {
        proxyId: proxy.proxyId,
        config,
        password: 'new-fixture-secret',
      }),
    ).toMatchObject({ ok: false, code: 'CREDENTIAL_UNAVAILABLE' })
    expect(snapshot()).toEqual(before)
  })
  it('does not report a committed save as failed when the cleanup status cannot be read', async () => {
    const { app, proxy, repository } = await fixture()
    const fault = vi.spyOn(repository, 'pendingCredentialCleanup').mockImplementation(() => {
      throw new Error('injected read failure')
    })
    expect(
      (
        await app.invoke('proxy:save', {
          proxyId: proxy.proxyId,
          config,
          password: 'new-fixture-secret',
        })
      ).ok,
    ).toBe(true)
    expect((await app.invoke('proxy:cleanup-status')).ok).toBe(false)
    fault.mockRestore()
    expect(await app.invoke('proxy:retry-cleanup')).toEqual({
      ok: true,
      data: { pendingCount: 0, temporaryFilesPending: false },
    })
  })
  it('exposes retryable cleanup without leaking references and rejects arguments on status IPC', async () => {
    const { app, proxy, repository } = await fixture()
    const complete = repository.completeCredentialCleanup.bind(repository)
    const fault = vi
      .spyOn(repository, 'completeCredentialCleanup')
      .mockImplementation((reference) => {
        if (reference === proxy.credentialRef) throw new Error('injected journal delete failure')
        complete(reference)
      })
    expect(
      (
        await app.invoke('proxy:save', {
          proxyId: proxy.proxyId,
          config,
          password: 'new-fixture-secret',
        })
      ).ok,
    ).toBe(true)
    const status = await app.invoke('proxy:cleanup-status')
    expect(status).toEqual({ ok: true, data: { pendingCount: 1, temporaryFilesPending: false } })
    expect(JSON.stringify(status)).not.toContain(proxy.credentialRef)
    for (const channel of ['proxy:cleanup-status', 'proxy:retry-cleanup'])
      expect(await app.invoke(channel, {})).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    fault.mockRestore()
    expect(await app.invoke('proxy:retry-cleanup')).toEqual({
      ok: true,
      data: { pendingCount: 0, temporaryFilesPending: false },
    })
  })
  it('updates active linked environments exactly once without rewriting trash or historical revisions', async () => {
    const { app, repository, proxy, snapshot } = await fixture()
    const before = snapshot()
    expect(
      (
        await app.invoke('proxy:save', {
          proxyId: proxy.proxyId,
          config: { ...config, port: 9090 },
          password: 'new-fixture-secret',
        })
      ).ok,
    ).toBe(true)
    for (const id of ['env-a', 'env-b']) {
      expect(repository.get(id)?.revision).toBe(2)
      expect(JSON.parse(repository.get(id)!.configJson).proxy.port).toBe(9090)
      expect(repository.getRevision(id, 1)).toBe(
        before.environments.find((env) => env.environmentId === id)?.configJson,
      )
    }
    expect(repository.get('env-trash')).toEqual(
      before.environments.find((env) => env.environmentId === 'env-trash'),
    )
    repository.restoreEnvironment('env-trash')
    const restored = environmentConfigSchema.parse(
      JSON.parse(repository.get('env-trash')!.configJson),
    )
    expect(restored.proxy?.port).toBe(8080)
    expect(resolveEnvironmentProxy(repository, restored).proxy?.port).toBe(9090)
  })
})
