import type { WorkspaceCredentialReference } from '@contextweave/contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { importProxyConfigurations } from './proxy-management'
import { redactProxyImportLine } from './proxy-import'
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-proxy-import-')),
    database = openLocalDatabase(join(root, 'db.sqlite'))
  const repository = new EnvironmentRepository(database.sqlite),
    secrets = new Map<string, string>()
  const credentials = {
    save: (key: WorkspaceCredentialReference, value: string) => {
      secrets.set(key.reference, value)
    },
    remove: (key?: WorkspaceCredentialReference) => {
      if (key) secrets.delete(key.reference)
    },
  }
  cleanups.push(() => {
    database.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { database, repository, secrets, credentials }
}
describe('Main-owned proxy import', () => {
  it('imports mixed protocols, isolates bad lines and skips duplicates without changing their passwords', () => {
    const { repository, credentials, secrets } = fixture()
    const input = {
      text: 'http://u:first@proxy.example:80\n\nhttps://secure.example:443\nsocks5://socks.example:1080\ninvalid\nhttp://u:replacement@proxy.example:80',
    }
    const rows = importProxyConfigurations(repository, input, credentials)
    expect(rows.map(({ line, status, code }) => ({ line, status, code }))).toEqual([
      { line: 1, status: 'created', code: undefined },
      { line: 3, status: 'created', code: undefined },
      { line: 4, status: 'created', code: undefined },
      { line: 5, status: 'error', code: 'INVALID_PROXY_LINE' },
      { line: 6, status: 'skipped', code: 'PROXY_ALREADY_EXISTS' },
    ])
    expect(repository.listProxies()).toHaveLength(3)
    expect([...secrets.values()]).toEqual(['first'])
    expect(JSON.stringify(rows)).not.toMatch(/first|replacement|credentialRef|password/)
    expect(
      importProxyConfigurations(repository, input, credentials).filter(
        (row) => row.status === 'created',
      ),
    ).toEqual([])
    expect(repository.listProxies()).toHaveLength(3)
  })
  it('compensates failed writes, continues later lines, and does not expose low-level errors', () => {
    const { repository, database, secrets, credentials } = fixture()
    database.sqlite.exec(
      "CREATE TRIGGER fail_one BEFORE INSERT ON proxies WHEN new.host = 'bad.example' BEGIN SELECT RAISE(ABORT, 'private storage path'); END;",
    )
    const rows = importProxyConfigurations(
      repository,
      {
        text: 'http://u:bad-secret@bad.example:80\nhttp://u:good-secret@good.example:80',
      },
      credentials,
    )
    expect(rows[0]).toMatchObject({
      line: 1,
      status: 'error',
      code: 'PROXY_SAVE_FAILED',
      proxy: { type: 'http', host: 'bad.example', port: 80, hasCredentials: true },
    })
    expect(rows[1]?.status).toBe('created')
    expect([...secrets.values()]).toEqual(['good-secret'])
    expect(repository.pendingCredentialCleanup()).toEqual([])
    expect(JSON.stringify(rows)).not.toContain('private storage path')
  })
})

describe('proxy import failures and redaction', () => {
  it('continues after every malformed line and exposes only validated endpoint projections', () => {
    const { repository, credentials } = fixture()
    const rows = importProxyConfigurations(
      repository,
      {
        text: [
          'http://private-user:private-password@bad.example:65536',
          'ftp://private-user:private-password@unsupported.example:80',
          'http://private-user:%zz@encoding.example:80',
          'broken private-user private-password',
          'http://private-user:1234:private-password@ambiguous.example:80',
          '[::1]:80:private-user:private-password',
          'http://healthy.example:80',
        ].join('\n'),
      },
      credentials,
    )
    expect(rows.map((row) => row.status)).toEqual([
      'error',
      'error',
      'error',
      'error',
      'error',
      'created',
      'created',
    ])
    expect(rows[0]?.proxy).toEqual({
      type: 'http',
      host: 'bad.example',
      port: 65536,
      hasCredentials: true,
    })
    expect(rows[1]?.proxy).toEqual({
      type: undefined,
      host: 'unsupported.example',
      port: 80,
      hasCredentials: true,
    })
    expect(rows[2]?.proxy?.host).toBe('encoding.example')
    expect(rows[3]?.proxy).toBeUndefined()
    expect(rows[4]?.proxy).toBeUndefined()
    expect(repository.listProxies()).toHaveLength(2)
    expect(JSON.stringify(rows)).not.toMatch(/private-user|private-password|%zz|broken|ambiguous/)
  })
  it.each(['CREDENTIAL_UNAVAILABLE', 'EACCES: private-password at private-path'])(
    'isolates secret-store refusal (%s) without saving unauthenticated substitutes',
    (message) => {
      const { repository, credentials, secrets } = fixture()
      const save = vi.fn(() => {
        throw new Error(message)
      })
      const text =
        'http://private-user:private-password@private.example:80\nprivate.example:80:private-user:replacement-password\npublic.example:80'
      const rows = importProxyConfigurations(repository, { text }, { ...credentials, save })
      expect(rows.map((row) => row.status)).toEqual(['error', 'error', 'created'])
      expect(rows.slice(0, 2).map((row) => row.code)).toEqual(
        Array(2).fill(
          message === 'CREDENTIAL_UNAVAILABLE' ? 'CREDENTIAL_UNAVAILABLE' : 'PROXY_SAVE_FAILED',
        ),
      )
      expect(save).toHaveBeenCalledTimes(2)
      expect(repository.listProxies()).toMatchObject([{ host: 'public.example' }])
      expect(secrets.size).toBe(0)
      expect(repository.pendingCredentialCleanup()).toEqual([])
      expect(JSON.stringify(rows)).not.toMatch(
        /private-user|private-password|replacement-password|private-path|EACCES/,
      )
      const retried = importProxyConfigurations(repository, { text }, credentials)
      expect(retried.map((row) => row.status)).toEqual(['created', 'skipped', 'skipped'])
      expect([...secrets.values()]).toEqual(['private-password'])
    },
  )
  it('cleans up a partially saved secret and allows the next same-identity line to succeed', () => {
    const { repository, credentials, secrets } = fixture()
    const save = vi.fn(credentials.save).mockImplementationOnce((reference, value) => {
      credentials.save(reference, value)
      throw new Error('private password storage failure')
    })
    const rows = importProxyConfigurations(
      repository,
      {
        text: 'host:80:user:first-secret\nhost:80:user:second-secret',
      },
      { ...credentials, save },
    )
    expect(rows.map((row) => row.status)).toEqual(['error', 'created'])
    expect([...secrets.values()]).toEqual(['second-secret'])
    expect(repository.pendingCredentialCleanup()).toEqual([])
  })
  it('treats blanks as non-items, preserves physical line numbers and skips existing/in-batch duplicates', () => {
    const { repository, credentials, secrets } = fixture()
    importProxyConfigurations(repository, { text: 'HOST:80:user:first-secret' }, credentials)
    const text = '\r\n \r\nhost:80:user:replacement-secret\r\nhttps://host:80:user:new-secret\r\n'
    const rows = importProxyConfigurations(repository, { text }, credentials)
    expect(rows.map(({ line, status }) => ({ line, status }))).toEqual([
      { line: 3, status: 'skipped' },
      { line: 4, status: 'created' },
    ])
    expect([...secrets.values()]).toEqual(['first-secret', 'new-secret'])
    const many = importProxyConfigurations(
      repository,
      { text: '\ninvalid\n '.repeat(200) },
      credentials,
    )
    expect(many).toHaveLength(200)
    expect(many.at(-1)?.line).toBe(400)
    expect(() => importProxyConfigurations(repository, { text: ' \n\r\n' }, credentials)).toThrow()
  })
  it.each([
    ['http://private-user:private-password@[::1]:8080', '[::1]', 8080],
    ['host:0:private-user:private-password', 'host', 0],
    ['socks5://host:1080:private-user:private-password:with:colons', 'host', 1080],
    ['https://private%40user:private%40password@host:443', 'host', 443],
  ])('redacts both usernames and passwords in %s', (line, host, port) => {
    const preview = redactProxyImportLine(line)
    expect(preview).toMatchObject({ host, port, hasCredentials: true })
    expect(JSON.stringify(preview)).not.toMatch(/private|user|password/)
  })
  it.each([
    'private-user:1234:private-password@host:80',
    'http://private-user:1234:private-password@word@host:80',
    'http://private-user:1234:private-password@host:80/path',
    'http://private-user:1234:private-password@host:80?query',
    'http://private-user:private-password@host:80/private-password',
    'http://private-user:private-password@host:80?password=private-password',
    'http://private-user:private-password@bad host:80',
    'private-user private-password',
    'http://private-user:private-password@host:999999999',
  ])('hides unidentifiable or ambiguous source text: %s', (line) => {
    expect(redactProxyImportLine(line)).toBeUndefined()
  })
})

it('preserves URI host normalization when skipping duplicate IPv6 connections', () => {
  const { repository, credentials, secrets } = fixture()
  const rows = importProxyConfigurations(
    repository,
    {
      text: 'http://user:first@[0:0:0:0:0:0:0:1]:80\nhttp://user:replacement@[::1]:80',
    },
    credentials,
  )
  expect(rows.map((row) => row.status)).toEqual(['created', 'skipped'])
  expect(rows.map((row) => row.proxy?.host)).toEqual(['[::1]', '[::1]'])
  expect([...secrets.values()]).toEqual(['first'])
})
