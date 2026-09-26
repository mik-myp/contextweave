import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KernelDmgCleanupError, withKernelDmg } from './kernel-dmg'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cw-dmg-cleanup-'))
  roots.push(root)
  const stage = join(root, '.install ~ fixture')
  await mkdir(stage)
  const archive = join(stage, 'package.download')
  await writeFile(archive, 'backing image fixture')
  const controller = new AbortController()
  let mount = ''
  const run = vi.fn<NonNullable<Parameters<typeof withKernelDmg>[4]>>(async (file, args) => {
    expect(file).toBe('/usr/bin/hdiutil')
    if (args[0] === 'attach') {
      mount = args[args.indexOf('-mountpoint') + 1]
      await mkdir(join(mount, 'Chromium.app'))
      await writeFile(join(mount, 'Chromium.app', 'sentinel'), 'mounted content')
    } else {
      // Only a fixture: unmount makes this simulated filesystem disappear from its mountpoint.
      await rename(join(mount, 'Chromium.app'), join(root, 'detached-volume'))
    }
  })
  return { root, stage, archive, controller, run, mount: () => mount }
}

describe('kernel DMG ownership and nonrecursive cleanup', () => {
  it('keeps a mount outside the recursive stage and removes only its empty directory after detach', async () => {
    const f = await fixture()
    await withKernelDmg(
      f.archive,
      f.stage,
      f.controller.signal,
      async (mount) => {
        expect(dirname(mount)).toBe(dirname(f.stage))
        expect(relative(f.stage, mount).startsWith('..')).toBe(true)
        expect(await readFile(join(mount, 'Chromium.app', 'sentinel'), 'utf8')).toBe(
          'mounted content',
        )
      },
      f.run,
    )
    expect(f.run.mock.calls[0][1]).toEqual([
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      f.mount(),
      f.archive,
    ])
    expect(f.run.mock.calls[1]).toEqual([
      '/usr/bin/hdiutil',
      ['detach', f.mount()],
      { timeout: 30000 },
    ])
    expect(await readdir(f.root)).not.toContain(f.mount().split(/[\\/]/).at(-1))
    expect(await readFile(join(f.root, 'detached-volume', 'sentinel'), 'utf8')).toBe(
      'mounted content',
    )
  })
  it('attempts detach after a pre-mount attach failure, then safely removes the empty directory', async () => {
    const f = await fixture()
    const read = vi.fn()
    f.run.mockImplementation(async () => {
      throw new Error('private OS diagnostic')
    })
    await expect(
      withKernelDmg(f.archive, f.stage, f.controller.signal, read, f.run),
    ).rejects.toThrow('ARCHIVE_MOUNT_FAILED')
    expect(read).not.toHaveBeenCalled()
    expect(f.run.mock.calls.map(([, args]) => args[0])).toEqual(['attach', 'detach'])
    expect(await readdir(f.root)).toEqual(['.install ~ fixture'])
  })
  it.each(['attach-error', 'attach-cancel', 'read-error', 'read-cancel'] as const)(
    'always detaches after %s and keeps the original failure when cleanup succeeds',
    async (mode) => {
      const f = await fixture()
      const original = f.run.getMockImplementation()!
      f.run.mockImplementation(async (file, args, options) => {
        await original(file, args, options)
        if (args[0] === 'attach' && mode.startsWith('attach')) {
          if (mode.endsWith('cancel')) f.controller.abort(new Error('cancelled'))
          throw new Error('private attach failure')
        }
      })
      const read = vi.fn(async () => {
        if (mode === 'read-cancel') f.controller.abort(new Error('cancelled'))
        f.controller.signal.throwIfAborted()
        throw new Error('ARCHIVE_UNSAFE')
      })
      const expected = mode.endsWith('cancel')
        ? 'cancelled'
        : mode === 'attach-error'
          ? 'ARCHIVE_MOUNT_FAILED'
          : 'ARCHIVE_UNSAFE'
      await expect(
        withKernelDmg(f.archive, f.stage, f.controller.signal, read, f.run),
      ).rejects.toThrow(expected)
      expect(f.run.mock.calls.at(-1)?.[2]).toEqual({ timeout: 30000 })
      expect(await readFile(join(f.root, 'detached-volume', 'sentinel'), 'utf8')).toBe(
        'mounted content',
      )
    },
  )
  it.each([false, true])(
    'preserves uncertain mounted contents and reports cleanup failure even if cancelled=%s',
    async (cancelled) => {
      const f = await fixture()
      const original = f.run.getMockImplementation()!
      f.run.mockImplementation(async (file, args, options) => {
        if (args[0] === 'detach') throw new Error('busy private mount')
        await original(file, args, options)
        if (cancelled) {
          f.controller.abort()
          throw new Error('aborted attach')
        }
      })
      await expect(
        withKernelDmg(f.archive, f.stage, f.controller.signal, async () => {}, f.run),
      ).rejects.toBeInstanceOf(KernelDmgCleanupError)
      // Even if an outer caller erroneously cleans stage, it cannot traverse the mount.
      await rm(f.stage, { recursive: true, force: true })
      expect(await readFile(join(f.mount(), 'Chromium.app', 'sentinel'), 'utf8')).toBe(
        'mounted content',
      )
    },
  )
  it('does not recursively clear unexpected files after detach reports success', async () => {
    const f = await fixture()
    await expect(
      withKernelDmg(
        f.archive,
        f.stage,
        f.controller.signal,
        async (mount) => {
          await writeFile(join(mount, 'unexpected'), 'retain')
        },
        f.run,
      ),
    ).rejects.toThrow('ARCHIVE_UNMOUNT_FAILED')
    expect(await readFile(join(f.mount(), 'unexpected'), 'utf8')).toBe('retain')
  })
  it('does not create a mount or invoke commands for an already-cancelled operation', async () => {
    const f = await fixture()
    f.controller.abort()
    await expect(
      withKernelDmg(f.archive, f.stage, f.controller.signal, vi.fn(), f.run),
    ).rejects.toThrow()
    expect(f.run).not.toHaveBeenCalled()
    expect(await readdir(f.root)).toEqual(['.install ~ fixture'])
  })
})
