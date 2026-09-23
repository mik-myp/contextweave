import { describe, expect, it, vi } from 'vitest'
import { defaultThemeConfig } from '@contextweave/contracts'
import { createThemePersistence } from './theme-persistence'

function deferred() {
  let resolve!: (value: { ok: boolean }) => void
  const promise = new Promise<{ ok: boolean }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('theme persistence', () => {
  it('serializes writes and ignores obsolete failures while a newer save is queued', async () => {
    const first = deferred()
    const second = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const persistence = createThemePersistence(write)
    const statuses: string[] = []
    persistence.subscribe(() => statuses.push(persistence.getSnapshot()))
    const saveFirst = persistence.save({ ...defaultThemeConfig, color: '#000000' })
    const latest = { ...defaultThemeConfig, color: '#FFFFFF' }
    const saveLatest = persistence.save(latest)
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(1)
    first.resolve({ ok: false })
    await saveFirst
    expect(persistence.getSnapshot()).toBe('saving')
    await Promise.resolve()
    expect(write).toHaveBeenNthCalledWith(2, latest)
    second.resolve({ ok: true })
    await saveLatest
    expect(statuses).toEqual(['saving', 'saved'])
  })

  it.each(['response', 'rejection'] as const)(
    'exposes %s failure and retries the latest snapshot',
    async (failure) => {
      const write = vi.fn()
      if (failure === 'response') write.mockResolvedValueOnce({ ok: false })
      else write.mockRejectedValueOnce(new Error('IPC disconnected'))
      write.mockResolvedValueOnce({ ok: true })
      const persistence = createThemePersistence(write)
      const latest = { ...defaultThemeConfig, color: '#7C3AED' }
      await expect(persistence.save(latest)).resolves.toBeUndefined()
      expect(persistence.getSnapshot()).toBe('error')
      await persistence.retry()
      expect(write).toHaveBeenLastCalledWith(latest)
      expect(persistence.getSnapshot()).toBe('saved')
    },
  )

  it('does not let an old success hide a later rejected write', async () => {
    const first = deferred()
    const write = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('offline'))
    const persistence = createThemePersistence(write)
    void persistence.save(defaultThemeConfig)
    const latest = persistence.save({ ...defaultThemeConfig, scale: 125 })
    first.resolve({ ok: true })
    await latest
    expect(persistence.getSnapshot()).toBe('error')
  })
})
