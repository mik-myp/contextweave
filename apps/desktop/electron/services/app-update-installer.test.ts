import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareAppInstaller, macUpdateScript, readInstallerFailure } from './app-update-installer'
const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cw-install-')))
  roots.push(root)
  const current = join(root, 'ContextWeave.app')
  await mkdir(join(current, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(current, 'old-version'), 'keep')
  const options = {
    platform: 'darwin' as const,
    arch: 'arm64' as const,
    isPackaged: true,
    portable: false,
    executablePath: join(current, 'Contents', 'MacOS', 'ContextWeave'),
    root: join(root, 'updates'),
    path: join(root, 'ContextWeave-0.2.0-mac-arm64.dmg'),
    release: {
      version: '0.2.0',
      url: 'https://github.com/mik-myp/contextweave/releases/tag/v0.2.0',
      publishedAt: '2026-09-24T00:00:00Z',
    },
    signal: new AbortController().signal,
  }
  const run = vi.fn<NonNullable<Parameters<typeof prepareAppInstaller>[1]>['execute']>(
    async (file, args) => {
      if (file.endsWith('hdiutil') && args[0] === 'attach') {
        await mkdir(
          join(args[args.indexOf('-mountpoint') + 1], 'ContextWeave.app', 'Contents', 'MacOS'),
          { recursive: true },
        )
        const header = Buffer.alloc(32)
        header.writeUInt32LE(0xfeedfacf, 0)
        header.writeUInt32LE(0x0100000c, 4)
        header.writeUInt32LE(2, 12)
        await writeFile(
          join(
            args[args.indexOf('-mountpoint') + 1],
            'ContextWeave.app',
            'Contents',
            'MacOS',
            'ContextWeave',
          ),
          header,
        )
      }
      if (file.endsWith('hdiutil') && args[0] === 'detach') {
        // A real detach removes the mounted filesystem, leaving its empty mountpoint.
        await rm(join(args[1], 'ContextWeave.app'), { recursive: true, force: true })
      }
      if (file.endsWith('plutil'))
        return {
          stdout:
            args[1] === 'CFBundleIdentifier'
              ? 'com.mikmyp.contextweave'
              : args[1] === 'CFBundleExecutable'
                ? 'ContextWeave'
                : '0.2.0',
          stderr: '',
        }
      if (file.endsWith('ditto')) await cp(args[0], args[1], { recursive: true })
      return { stdout: '', stderr: 'TeamIdentifier=not set\n' }
    },
  )
  const launch = vi.fn(async (_file: string, args: string[]) => {
    await writeFile(args[4], 'ready\n')
  })
  return { root, current, options, run, launch }
}
describe('automatic installer boundary', () => {
  it('prepares a verified bundle on the same volume without touching the running installation', async () => {
    const f = await fixture()
    const prepared = await prepareAppInstaller(f.options, { execute: f.run, launch: f.launch })
    expect(await readFile(join(f.current, 'old-version'), 'utf8')).toBe('keep')
    expect(f.launch).not.toHaveBeenCalled()
    expect(f.run).toHaveBeenCalledWith(
      '/usr/bin/hdiutil',
      expect.arrayContaining(['attach', '-readonly', '-nobrowse']),
      expect.anything(),
    )
    await prepared.launch()
    expect(f.launch).toHaveBeenCalledWith(
      '/bin/sh',
      expect.arrayContaining([f.current, String(process.pid)]),
    )
    await prepared.cleanup()
    expect((await readdir(f.root)).some((name) => name.startsWith('.contextweave-update-'))).toBe(
      false,
    )
  })
  it('does not traverse a partially mounted image when attach and detach both fail', async () => {
    const f = await fixture(),
      original = f.run.getMockImplementation()!
    let mount = ''
    f.run.mockImplementation(async (file, args, opts) => {
      if (file.endsWith('hdiutil') && args[0] === 'attach') {
        mount = args[args.indexOf('-mountpoint') + 1]
        await original(file, args, opts)
        await writeFile(join(mount, 'ContextWeave.app', 'must-not-delete'), 'mounted-content')
        throw new Error('ATTACH_FAILED')
      }
      if (file.endsWith('hdiutil') && args[0] === 'detach') throw new Error('BUSY')
      return original(file, args, opts)
    })
    await expect(
      prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
    ).rejects.toThrow('ATTACH_FAILED')
    expect(await readFile(join(mount, 'ContextWeave.app', 'must-not-delete'), 'utf8')).toBe(
      'mounted-content',
    )
    expect(f.launch).not.toHaveBeenCalled()
  })
  it('cleans an empty mountpoint after an attach failure without changing the running app', async () => {
    const f = await fixture(),
      original = f.run.getMockImplementation()!
    f.run.mockImplementation(async (file, args, opts) => {
      if (file.endsWith('hdiutil')) throw new Error('ATTACH_FAILED')
      return original(file, args, opts)
    })
    await expect(
      prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
    ).rejects.toThrow('ATTACH_FAILED')
    expect(await readdir(f.options.root)).toEqual([])
    expect(await readFile(join(f.current, 'old-version'), 'utf8')).toBe('keep')
  })
  it('refuses to launch if the staged image cannot be safely unmounted', async () => {
    const f = await fixture(),
      original = f.run.getMockImplementation()!
    f.run.mockImplementation(async (file, args, opts) => {
      if (file.endsWith('hdiutil') && args[0] === 'detach') throw new Error('BUSY')
      return original(file, args, opts)
    })
    await expect(
      prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
    ).rejects.toThrow('UPDATE_UNMOUNT_FAILED')
    expect(f.launch).not.toHaveBeenCalled()
    expect(await readFile(join(f.current, 'old-version'), 'utf8')).toBe('keep')
  })
  it.each(['truncated', 'wrong-architecture', 'not-executable'])(
    'rejects a %s Mach-O without invoking developer tools or changing the current app',
    async (mode) => {
      const f = await fixture(),
        original = f.run.getMockImplementation()!
      f.run.mockImplementation(async (file, args, opts) => {
        const result = await original(file, args, opts)
        if (file.endsWith('hdiutil') && args[0] === 'attach') {
          const executable = join(
            args[args.indexOf('-mountpoint') + 1],
            'ContextWeave.app',
            'Contents',
            'MacOS',
            'ContextWeave',
          )
          const bytes = await readFile(executable)
          if (mode === 'wrong-architecture') bytes.writeUInt32LE(0x01000007, 4)
          if (mode === 'not-executable') bytes.writeUInt32LE(6, 12)
          await writeFile(executable, mode === 'truncated' ? bytes.subarray(0, 7) : bytes)
        }
        return result
      })
      await expect(
        prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
      ).rejects.toThrow('UPDATE_INSTALL_INVALID')
      expect(f.run.mock.calls.some(([file]) => file.includes('lipo'))).toBe(false)
      expect(f.launch).not.toHaveBeenCalled()
      expect(await readFile(join(f.current, 'old-version'), 'utf8')).toBe('keep')
    },
  )
  it.each(['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleExecutable'])(
    'rejects invalid %s without replacing the old bundle',
    async (field) => {
      const f = await fixture(),
        original = f.run.getMockImplementation()!
      f.run.mockImplementation(async (file, args, opts) =>
        file.endsWith('plutil') && args[1] === field
          ? { stdout: 'wrong', stderr: '' }
          : original(file, args, opts),
      )
      await expect(
        prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
      ).rejects.toThrow('UPDATE_INSTALL_INVALID')
      expect(await readFile(join(f.current, 'old-version'), 'utf8')).toBe('keep')
      expect((await readdir(f.root)).some((name) => name.startsWith('.contextweave-update-'))).toBe(
        false,
      )
      expect(f.launch).not.toHaveBeenCalled()
    },
  )
  it('does not downgrade an existing Developer ID identity or treat signature inspection failure as unsigned', async () => {
    const f = await fixture(),
      original = f.run.getMockImplementation()!
    f.run.mockImplementation(async (file, args, opts) =>
      file.endsWith('codesign')
        ? {
            stdout: '',
            stderr: `TeamIdentifier=${args.at(-1) === f.current ? 'EXPECTED' : 'OTHER'}`,
          }
        : original(file, args, opts),
    )
    await expect(
      prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
    ).rejects.toThrow('UPDATE_SIGNATURE_MISMATCH')
    f.run.mockImplementation(async (file, args, opts) => {
      if (file.endsWith('codesign')) throw new Error('permission failure')
      return original(file, args, opts)
    })
    await expect(
      prepareAppInstaller(f.options, { execute: f.run, launch: f.launch }),
    ).rejects.toThrow('UPDATE_SIGNATURE_INVALID')
  })
  it('rejects development and portable installs without executing commands', async () => {
    const f = await fixture()
    for (const change of [{ isPackaged: false }, { portable: true }])
      await expect(
        prepareAppInstaller({ ...f.options, ...change }, { execute: f.run, launch: f.launch }),
      ).rejects.toThrow(/UPDATE_(DEVELOPMENT_MODE|PORTABLE_UNSUPPORTED)/)
    expect(f.run).not.toHaveBeenCalled()
  })
  it('uses the installed Windows NSIS update protocol, not shell.openPath', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'Uninstall ContextWeave.exe'), 'fixture')
    const options = {
      ...f.options,
      platform: 'win32' as const,
      arch: 'x64' as const,
      executablePath: join(f.root, 'ContextWeave.exe'),
      path: join(f.root, 'ContextWeave-0.2.0-win-x64-setup.exe'),
    }
    const launch = vi.fn(async () => {})
    const prepared = await prepareAppInstaller(options, { execute: f.run, launch })
    await prepared.launch()
    expect(launch).toHaveBeenCalledWith(options.path, ['--updated', '/S', '--force-run'])
    expect(f.run).not.toHaveBeenCalled()
  })
  it.skipIf(process.platform === 'win32')(
    'quotes helper paths and retains the old app during a successful replacement',
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cw-helper-'$-"))
      roots.push(root)
      const current = join(root, 'ContextWeave.app'),
        stage = join(root, 'stage')
      await mkdir(current)
      await writeFile(join(current, 'old'), 'previous')
      await mkdir(join(stage, 'ContextWeave.app'), { recursive: true })
      await writeFile(join(stage, 'ContextWeave.app', 'new'), 'next')
      // Stub only the OS launcher: exercise the actual wait/swap/backup shell operations.
      const script = join(root, 'install.sh')
      await writeFile(script, macUpdateScript.replaceAll('/usr/bin/open -n', 'true'))
      await execute('/bin/sh', [
        script,
        current,
        stage,
        '99999999',
        join(root, 'ready'),
        join(root, 'last-install-result'),
      ])
      expect(await readFile(join(current, 'new'), 'utf8')).toBe('next')
      expect(await readFile(join(stage, 'previous.app', 'old'), 'utf8')).toBe('previous')
      expect(readInstallerFailure(root)).toBeUndefined()
    },
  )
})

it.skipIf(process.platform === 'win32')(
  'restores the original app if the second rename fails before launching new code',
  async () => {
    const f = await fixture(),
      stage = join(f.root, 'stage')
    await mkdir(join(stage, 'ContextWeave.app'), { recursive: true })
    const script = join(f.root, 'failure.sh')
    await writeFile(
      script,
      macUpdateScript
        .replace('! /bin/mv "$next" "$current"', '! false')
        .replaceAll('/usr/bin/open -n', 'true'),
    )
    await expect(
      execute('/bin/sh', [
        script,
        f.current,
        stage,
        '99999999',
        join(f.root, 'ready'),
        join(f.root, 'last-install-result'),
      ]),
    ).rejects.toThrow()
    expect(await readFile(join(f.current, 'old-version'), 'utf8')).toBe('keep')
    expect(readInstallerFailure(f.root)).toBe('UPDATE_REPLACE_FAILED')
  },
)
