import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-application-boundary-'))
  mkdirSync(join(root, 'environments'))
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
  const app = createApplication({
    repository,
    dataRoot: root,
    platform: 'darwin',
    arch: 'arm64',
    secure: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    workerPath: join(root, 'must-not-run.js'),
    changed: () => {},
  })
  cleanups.push(async () => {
    await app.shutdown()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { app, root, db, repository }
}

describe('application command boundary', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'unknown:command'])(
    'does not dispatch inherited or unknown command %s',
    async (channel) => {
      const { app } = fixture()
      expect(await app.invoke(channel)).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' })
      expect(app.channels).not.toContain(channel)
    },
  )

  it.each([
    'kernel:providers',
    'kernel:list',
    'environment:list',
    'environment:trash-list',
    'activity:list',
    'operation:list',
    'storage:orphans',
    'proxy:list',
    'settings:get-theme',
    'proxy:cleanup-status',
    'proxy:retry-cleanup',
  ])('rejects payloads for no-argument command %s', async (channel) => {
    const { app } = fixture()
    for (const input of [null, {}, 'unexpected', ['unexpected']])
      expect(await app.invoke(channel, input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect((await app.invoke(channel)).ok).toBe(true)
  })

  it('refuses invalid input before it can create resources or launch a worker', async () => {
    const { app, repository, root } = fixture()
    expect(await app.invoke('environment:create', { name: 'incomplete' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(await app.invoke('worker:run-smoke', { taskId: '../outside' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(await app.invoke('worker:cancel', '../outside')).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(repository.listAll()).toEqual([])
    expect(repository.listOperations()).toEqual([])
    expect(existsSync(join(root, 'worker-results'))).toBe(false)
  })

  it('blocks commands during installation and after shutdown without losing persisted data', async () => {
    const { app, repository } = fixture()
    repository.setSetting('fixture', 'keep')
    app.setUpdating(true)
    expect(await app.invoke('proxy:list')).toMatchObject({ ok: false, code: 'APP_UPDATING' })
    app.setUpdating(false)
    expect(await app.invoke('proxy:list')).toEqual({ ok: true, data: [] })
    await app.shutdown()
    expect(await app.invoke('proxy:list')).toMatchObject({ ok: false, code: 'APP_CLOSING' })
    expect(repository.getSetting('fixture')).toBe('keep')
  })
})
