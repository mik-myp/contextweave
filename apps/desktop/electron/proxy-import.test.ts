import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { importProxyConfigurations } from './proxy-management'
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
    save: (key: string, value: string) => {
      secrets.set(key, value)
    },
    remove: (key?: string) => {
      if (key) secrets.delete(key)
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
      defaultType: 'http',
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
        defaultType: 'http',
        text: 'http://u:bad-secret@bad.example:80\nhttp://u:good-secret@good.example:80',
      },
      credentials,
    )
    expect(rows[0]).toEqual({ line: 1, status: 'error', code: 'PROXY_SAVE_FAILED' })
    expect(rows[1]?.status).toBe('created')
    expect([...secrets.values()]).toEqual(['good-secret'])
    expect(repository.pendingCredentialCleanup()).toEqual([])
    expect(JSON.stringify(rows)).not.toContain('private storage path')
  })
})
