import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createCommandCoordinator } from './command-coordinator'
import { environmentCommandOutcome } from './environment-command-dispatcher'
const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) close()
})
function fixture() {
  const db = openLocalDatabase(':memory:')
  cleanup.push(db.close)
  const repository = new EnvironmentRepository(db.sqlite)
  return { db, repository, service: createCommandCoordinator(repository, vi.fn()) }
}
describe('command log failure propagation', () => {
  it('does not run an effect when its operation record cannot be written', async () => {
    const f = fixture(),
      effect = vi.fn(() => ({ ok: true as const, data: true }))
    vi.spyOn(f.repository, 'createOperation').mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(await f.service.run('create', 'env', effect)).toMatchObject({
      ok: false,
      code: 'COMMAND_STORAGE_FAILED',
    })
    expect(effect).not.toHaveBeenCalled()
    expect(f.service.busy('env')).toBe(false)
  })
  it('remembers a phase persistence failure even if an executor catches it while cleaning up', async () => {
    const f = fixture()
    vi.spyOn(f.repository, 'updateOperation').mockImplementation(() => {
      throw new Error('disk full')
    })
    const result = await f.service.run('start', 'env', (phase) => {
      expect(() => phase('launch')).toThrow('COMMAND_STORAGE_FAILED')
      return { ok: false, code: 'START_FAILED', message: 'cleanup complete' }
    })
    expect(result).toMatchObject({ ok: false, code: 'COMMAND_STORAGE_FAILED' })
    expect(environmentCommandOutcome(result)).toEqual({
      status: 'unknown',
      errorCode: 'COMMAND_STORAGE_FAILED',
    })
  })
  it('never turns failed completion persistence or a native SQLite mutation failure into success', async () => {
    const f = fixture()
    f.db.sqlite.exec(
      "CREATE TEMP TRIGGER fault BEFORE UPDATE ON operations BEGIN SELECT RAISE(ABORT,'injected'); END",
    )
    const effect = vi.fn(() => ({ ok: true as const, data: true }))
    expect(await f.service.run('update', 'env', effect)).toMatchObject({
      ok: false,
      code: 'COMMAND_STORAGE_FAILED',
    })
    expect(effect).toHaveBeenCalledTimes(1)
    f.db.sqlite.exec('DROP TRIGGER fault')
    expect(
      await f.service.run('update', 'env', () => {
        f.db.sqlite.exec('SELECT missing FROM missing_table')
        return { ok: true, data: true }
      }),
    ).toMatchObject({ ok: false, code: 'COMMAND_STORAGE_FAILED' })
  })
  it('only classifies known pre-effect refusals as definite failure; ambiguous results require inspection', () => {
    expect(
      environmentCommandOutcome({ ok: false, code: 'CONFIG_CONFLICT', message: 'safe' }),
    ).toEqual({ status: 'failed', errorCode: 'CONFIG_CONFLICT' })
    expect(
      environmentCommandOutcome({ ok: false, code: 'STOP_TIMEOUT', message: 'private' }),
    ).toEqual({ status: 'unknown', errorCode: 'STOP_TIMEOUT' })
    expect(
      environmentCommandOutcome({ ok: false, code: 'private raw error', message: 'private' }),
    ).toEqual({ status: 'unknown', errorCode: 'COMMAND_RESULT_UNKNOWN' })
  })
})
