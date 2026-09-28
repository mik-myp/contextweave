import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  ArtifactRepository,
  EnvironmentRepository,
  openLocalDatabase,
  WorkspaceRepository,
} from '@contextweave/storage'
import { type DataChanged } from '@contextweave/contracts'
import { createApplication } from './application'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-bookmarks-ipc-'))
  mkdirSync(join(root, 'environments'))
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  const repository = new EnvironmentRepository(db.sqlite)
  const events: DataChanged[] = []
  const app = createApplication({
    repository,
    dataRoot: root,
    workspaceRepository: new WorkspaceRepository(db.sqlite),
    artifactRepository: new ArtifactRepository(db.sqlite),
    platform: 'darwin',
    arch: 'arm64',
    secure: {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from(v),
      decryptString: (v) => v.toString(),
    },
    workerPath: join(root, 'not-used.js'),
    forkWorker: () => {
      throw new Error('Unexpected worker')
    },
    changed: (event) => events.push(event),
  })
  cleanups.push(async () => {
    await app.shutdown()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const invoke = (channel: string, payload?: unknown) =>
    app.invoke(channel, { ...repository.context, payload })
  return { app, repository, invoke, events }
}
const item = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Example',
  url: 'https://example.test/',
}
it('registers only scoped read/save commands, persists ordered templates and emits a scoped invalidation', async () => {
  const f = fixture()
  expect(f.app.channels).toEqual(expect.arrayContaining(['bookmarks:get', 'bookmarks:save']))
  expect(await f.invoke('bookmarks:get')).toEqual({
    ok: true,
    data: { ...f.repository.context, revision: 0, items: [] },
  })
  expect(await f.invoke('bookmarks:save', { expectedRevision: 0, items: [item] })).toEqual({
    ok: true,
    data: { ...f.repository.context, revision: 1, items: [item] },
  })
  expect(f.events).toEqual([{ ...f.repository.context, domains: ['bookmarks'] }])
  expect(await f.invoke('bookmarks:save', { expectedRevision: 0, items: [] })).toMatchObject({
    ok: false,
    code: 'BOOKMARKS_CONFLICT',
  })
  expect(f.events).toHaveLength(1)
})
it('rejects missing/forged workspace scope, unsafe URLs, path fields and read payloads before mutation', async () => {
  const a = fixture(),
    b = fixture()
  expect(
    await a.app.invoke('bookmarks:save', { expectedRevision: 0, items: [item] }),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_CONTEXT_INVALID' })
  expect(
    await a.app.invoke('bookmarks:get', { ...b.repository.context, payload: undefined }),
  ).toMatchObject({ ok: false, code: 'WORKSPACE_MISMATCH' })
  for (const payload of [
    null,
    {},
    { expectedRevision: 0, items: [item], path: '/tmp' },
    { expectedRevision: 0, items: [{ ...item, url: 'https://u:p@e.test' }] },
  ])
    expect(await a.invoke('bookmarks:save', payload)).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
  expect(await a.invoke('bookmarks:get', {})).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  expect(a.events).toEqual([])
  expect(await a.invoke('bookmarks:get')).toMatchObject({ ok: true, data: { items: [] } })
  expect(await b.invoke('bookmarks:get')).toMatchObject({ ok: true, data: { items: [] } })
})
it('does not offer any renderer command to rewrite a profile or clear initialization guards', async () => {
  const f = fixture()
  for (const channel of ['bookmarks:initialize', 'bookmarks:profile-reset', 'bookmarks:open'])
    expect(await f.invoke(channel, {})).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' })
  await f.app.shutdown()
  expect(await f.invoke('bookmarks:save', { expectedRevision: 0, items: [item] })).toMatchObject({
    ok: false,
    code: 'APP_CLOSING',
  })
})
