import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'
import { testProxyTransport } from './services/proxy-transport'

vi.mock('./services/proxy-transport', async (original) => ({
  ...(await original<typeof import('./services/proxy-transport')>()),
  testProxyTransport: vi.fn(async () => ({
    success: true,
    latencyMs: 1,
    checkedAt: '2026-09-24T00:00:00.000Z',
  })),
}))

const config = { type: 'http' as const, host: 'proxy.example', port: 8080, username: 'alice' }
const cleanups: Array<() => Promise<void>> = []

beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'cw-proxy-security-'))
  const database = openLocalDatabase(join(directory, 'test.sqlite'))
  const repository = new EnvironmentRepository(database.sqlite)
  const secure = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: (value: string) => Buffer.from(value),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  }
  const application = createApplication({
    repository,
    dataRoot: directory,
    platform: 'linux',
    arch: 'x64',
    secure,
    workerPath: join(directory, 'unused-worker.cjs'),
    changed: () => {},
  })
  cleanups.push(async () => {
    await application.shutdown()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const saved = await application.invoke('proxy:save', { config, password: 'saved-test-secret' })
  expect(saved.ok).toBe(true)
  const proxy = repository.listProxies()[0]!
  return { application, repository, secure, proxy }
}

describe('proxy command credential target binding', () => {
  it.each([
    { host: 'other.example' },
    { port: 9090 },
    { type: 'https' },
    { type: 'socks5' },
    { username: 'bob' },
  ])('rejects credential reuse for a changed target: %j', async (change) => {
    const { application, secure, proxy } = await setup()
    const result = await application.invoke('proxy:test', {
      proxyId: proxy.proxyId,
      config: { ...config, ...change },
    })
    expect(result).toMatchObject({ ok: false, code: 'PROXY_CREDENTIAL_TARGET_CHANGED' })
    expect(secure.decryptString).not.toHaveBeenCalled()
    expect(testProxyTransport).not.toHaveBeenCalled()
  })

  it('cannot bypass test binding by saving the changed target first', async () => {
    const { application, repository, secure, proxy } = await setup()
    expect(
      await application.invoke('proxy:save', {
        proxyId: proxy.proxyId,
        config: { ...config, host: 'other.example' },
      }),
    ).toMatchObject({ ok: false, code: 'PROXY_CREDENTIAL_TARGET_CHANGED' })
    expect(repository.getProxy(proxy.proxyId)).toMatchObject({
      host: config.host,
      credentialRef: proxy.credentialRef,
    })
    expect(secure.decryptString).not.toHaveBeenCalled()
    expect(testProxyTransport).not.toHaveBeenCalled()
  })

  it('tests the saved endpoint by ID and preserves its secret for a name-only edit', async () => {
    const { application, proxy } = await setup()
    expect(await application.invoke('proxy:test', { proxyId: proxy.proxyId })).toMatchObject({
      ok: true,
    })
    expect(testProxyTransport).toHaveBeenLastCalledWith(
      expect.objectContaining(config),
      'saved-test-secret',
    )
    expect(
      await application.invoke('proxy:test', {
        proxyId: proxy.proxyId,
        config: { ...config, name: 'Renamed proxy' },
      }),
    ).toMatchObject({ ok: true })
    expect(testProxyTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Renamed proxy' }),
      'saved-test-secret',
    )
  })

  it('allows an explicitly supplied password for a new target without decrypting the saved one', async () => {
    const { application, secure, proxy } = await setup()
    const changed = { ...config, host: 'other.example' }
    expect(
      await application.invoke('proxy:test', {
        proxyId: proxy.proxyId,
        config: changed,
        password: 'new-test-secret',
      }),
    ).toMatchObject({ ok: true })
    expect(testProxyTransport).toHaveBeenLastCalledWith(
      expect.objectContaining(changed),
      'new-test-secret',
    )
    expect(secure.decryptString).not.toHaveBeenCalled()
  })

  it.each([
    { config: { ...config, host: 'other.example' }, clearPassword: true },
    { config: { ...config, host: 'other.example', username: undefined } },
  ])('can explicitly test without the saved password: %j', async (input) => {
    const { application, secure, proxy } = await setup()
    expect(
      await application.invoke('proxy:test', { proxyId: proxy.proxyId, ...input }),
    ).toMatchObject({ ok: true })
    expect(testProxyTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'other.example' }),
      '',
    )
    expect(secure.decryptString).not.toHaveBeenCalled()
  })

  it('preserves a password for a hostname case change without relaxing endpoint matching', async () => {
    const { application, proxy } = await setup()
    expect(
      await application.invoke('proxy:test', {
        proxyId: proxy.proxyId,
        config: { ...config, host: 'PROXY.EXAMPLE' },
      }),
    ).toMatchObject({ ok: true })
    expect(testProxyTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'PROXY.EXAMPLE' }),
      'saved-test-secret',
    )
  })

  it.each([
    { config: { ...config, host: 'other.example' }, password: 'replacement-secret' },
    { config: { ...config, host: 'other.example' }, clearPassword: true },
    { config: { ...config, host: 'other.example', username: undefined } },
  ])('saves an explicit credential replacement or removal on target change: %j', async (input) => {
    const { application, repository, secure, proxy } = await setup()
    expect(
      await application.invoke('proxy:save', { proxyId: proxy.proxyId, ...input }),
    ).toMatchObject({ ok: true })
    expect(secure.decryptString).not.toHaveBeenCalled()
    expect(repository.getProxy(proxy.proxyId)?.credentialRef).not.toBe(proxy.credentialRef)
    expect(await application.invoke('proxy:test', { proxyId: proxy.proxyId })).toMatchObject({
      ok: true,
    })
    expect(testProxyTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'other.example' }),
      input.password ?? '',
    )
  })

  it('does not send a request when a saved proxy is missing or its secret is unavailable', async () => {
    const { application, secure, proxy } = await setup()
    expect(await application.invoke('proxy:test', { proxyId: 'missing' })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    secure.isEncryptionAvailable.mockReturnValue(false)
    expect(await application.invoke('proxy:test', { proxyId: proxy.proxyId })).toMatchObject({
      ok: false,
      code: 'CREDENTIAL_UNAVAILABLE',
    })
    expect(testProxyTransport).not.toHaveBeenCalled()
  })
})
