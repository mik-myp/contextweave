import { execFile, spawn } from 'node:child_process'
import { readFileSync, statSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AppUpdateRelease, TargetArchitecture, TargetPlatform } from '@contextweave/contracts'
import { assertBundleLinks } from './kernel-archive'

const exec = promisify(execFile)
type Execute = (
  file: string,
  args: string[],
  options: { signal?: AbortSignal; timeout: number },
) => Promise<{ stdout: string; stderr: string }>
const execute: Execute = (file, args, options) => exec(file, args, { ...options, encoding: 'utf8' })

// All paths are separate argv values, never interpolated into executable shell text.
export const macUpdateScript = `#!/bin/sh
set -u
current="$1"
stage="$2"
parent="$3"
ready="$4"
report="$5"
next="$stage/ContextWeave.app"
previous="$stage/previous.app"
finish() { printf '%s\\n' "$1" > "$report"; }
if [ ! -d "$current" ] || [ -L "$current" ] || [ ! -d "$next" ] || [ -e "$previous" ]; then
  finish UPDATE_INSTALL_INVALID
  exit 1
fi
printf '%s\\n' ready > "$ready" || exit 1
tries=0
while kill -0 "$parent" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 120 ]; then finish UPDATE_QUIT_TIMEOUT; exit 1; fi
  sleep 1
done
if ! /bin/mv "$current" "$previous"; then
  finish UPDATE_REPLACE_FAILED
  /usr/bin/open -n "$current"
  exit 1
fi
if [ -e "$current" ] || ! /bin/mv "$next" "$current"; then
  if [ ! -e "$current" ] && /bin/mv "$previous" "$current"; then
    finish UPDATE_REPLACE_FAILED
    /usr/bin/open -n "$current"
  else
    finish UPDATE_ROLLBACK_FAILED
  fi
  exit 1
fi
# A new binary may migrate user data: never downgrade it automatically after launch.
if /usr/bin/open -n "$current"; then finish UPDATE_LAUNCHED; else finish UPDATE_RESTART_FAILED; exit 1; fi
`

async function launchDetached(file: string, args: string[]) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
  await new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('UPDATE_OPEN_FAILED')))
    child.once('spawn', resolve)
  })
  child.unref()
}

async function bundleValue(bundle: string, key: string, signal: AbortSignal, execute: Execute) {
  const result = await execute(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')],
    { signal, timeout: 10000 },
  )
  return result.stdout.trim()
}
async function assertMacExecutable(path: string, arch: TargetArchitecture, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!(await lstat(path)).isFile()) throw new Error('UPDATE_INSTALL_INVALID')
  const file = await open(path, 'r')
  try {
    // Official releases are separate arm64/x64 bundles, not universal binaries.
    // Read the bounded mach_header_64 directly: /usr/bin/lipo can require Xcode tools.
    const header = Buffer.alloc(32)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    signal.throwIfAborted()
    if (
      bytesRead !== header.length ||
      header.readUInt32LE(0) !== 0xfeedfacf ||
      header.readUInt32LE(4) !== (arch === 'arm64' ? 0x0100000c : 0x01000007) ||
      header.readUInt32LE(12) !== 2 // MH_EXECUTE, not a dylib or arbitrary renamed file.
    )
      throw new Error('UPDATE_INSTALL_INVALID')
  } finally {
    await file.close()
  }
}
async function signingTeam(bundle: string, signal: AbortSignal, execute: Execute) {
  try {
    const result = await execute('/usr/bin/codesign', ['-d', '--verbose=4', bundle], {
      signal,
      timeout: 30000,
    })
    const team = /^TeamIdentifier=(.+)$/m.exec(result.stderr)?.[1]
    return team && team !== 'not set' ? team : undefined
  } catch (error) {
    signal.throwIfAborted()
    if (
      error &&
      typeof error === 'object' &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.includes('code object is not signed at all')
    )
      return undefined
    throw new Error('UPDATE_SIGNATURE_INVALID')
  }
}

export async function prepareAppInstaller(
  options: {
    platform: TargetPlatform
    arch: TargetArchitecture
    isPackaged: boolean
    executablePath: string
    portable: boolean
    root: string
    path: string
    release: AppUpdateRelease
    signal: AbortSignal
  },
  dependencies: { execute: Execute; launch: typeof launchDetached } = {
    execute,
    launch: launchDetached,
  },
): Promise<{ launch(): Promise<void>; cleanup(): Promise<void> }> {
  const { execute, launch } = dependencies
  const { signal } = options
  if (!options.isPackaged) throw new Error('UPDATE_DEVELOPMENT_MODE')
  if (options.portable) throw new Error('UPDATE_PORTABLE_UNSUPPORTED')
  signal.throwIfAborted()
  if (options.platform === 'win32' && options.arch === 'x64') {
    const uninstaller = join(dirname(options.executablePath), 'Uninstall ContextWeave.exe')
    if (!(await lstat(uninstaller).catch(() => undefined))?.isFile())
      throw new Error('UPDATE_INSTALL_LOCATION')
    if (basename(options.path) !== `ContextWeave-${options.release.version}-win-x64-setup.exe`)
      throw new Error('UPDATE_INSTALL_INVALID')
    return {
      // NSIS's --updated protocol waits for the old application; --force-run starts the new one.
      launch: () => launch(options.path, ['--updated', '/S', '--force-run']),
      cleanup: async () => {},
    }
  }
  if (options.platform !== 'darwin') throw new Error('PLATFORM_UNSUPPORTED')
  const originalPath = dirname(dirname(dirname(options.executablePath)))
  const current = await realpath(originalPath)
  if (basename(originalPath) !== 'ContextWeave.app' || (await lstat(originalPath)).isSymbolicLink())
    throw new Error('UPDATE_INSTALL_LOCATION')
  if (basename(options.path) !== `ContextWeave-${options.release.version}-mac-${options.arch}.dmg`)
    throw new Error('UPDATE_INSTALL_INVALID')
  await mkdir(options.root, { recursive: true })
  let stage: string
  try {
    stage = await mkdtemp(join(dirname(current), '.contextweave-update-'))
  } catch {
    throw new Error('UPDATE_INSTALL_PERMISSION')
  }
  const cleanup = () => rm(stage, { recursive: true, force: true })
  let mount: string | undefined
  let prepared: { launch(): Promise<void>; cleanup(): Promise<void> } | undefined
  let failure: unknown
  try {
    mount = await mkdtemp(join(options.root, '.install-mount-'))
    // Only a verified official DMG reaches this boundary; never execute anything from the mount.
    await execute(
      '/usr/bin/hdiutil',
      ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, options.path],
      { signal, timeout: 60000 },
    )
    const candidate = join(mount, 'ContextWeave.app')
    const info = await lstat(candidate)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('UPDATE_INSTALL_INVALID')
    await assertBundleLinks(candidate, signal)
    if (
      (await bundleValue(candidate, 'CFBundleIdentifier', signal, execute)) !==
        'com.mikmyp.contextweave' ||
      (await bundleValue(candidate, 'CFBundleShortVersionString', signal, execute)) !==
        options.release.version ||
      (await bundleValue(candidate, 'CFBundleExecutable', signal, execute)) !== 'ContextWeave'
    )
      throw new Error('UPDATE_INSTALL_INVALID')
    await assertMacExecutable(
      join(candidate, 'Contents', 'MacOS', 'ContextWeave'),
      options.arch,
      signal,
    )
    const team = await signingTeam(current, signal, execute)
    if (team) {
      if ((await signingTeam(candidate, signal, execute)) !== team)
        throw new Error('UPDATE_SIGNATURE_MISMATCH')
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], {
        signal,
        timeout: 60000,
      })
    }
    // ditto preserves bundle modes, symlinks and extended attributes. No quarantine removal.
    await execute('/usr/bin/ditto', [candidate, join(stage, 'ContextWeave.app')], {
      signal,
      timeout: 120000,
    })
    await assertBundleLinks(join(stage, 'ContextWeave.app'), signal)
    const helper = join(stage, 'install.sh'),
      ready = join(stage, 'ready')
    await writeFile(helper, macUpdateScript, { mode: 0o700, flag: 'wx' })
    signal.throwIfAborted()
    prepared = {
      cleanup,
      async launch() {
        await launch('/bin/sh', [
          helper,
          current,
          stage,
          String(process.pid),
          ready,
          join(options.root, 'last-install-result'),
        ])
        for (let attempt = 0; attempt < 50; attempt++) {
          if ((await readFile(ready, 'utf8').catch(() => '')) === 'ready\n') return
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('UPDATE_OPEN_FAILED')
      },
    }
  } catch (error) {
    failure = error
  }
  try {
    if (mount) {
      // attach can fail or be aborted after mounting. Always attempt detach, and never
      // recursively remove a mountpoint (not even when attach reported a failure).
      await execute('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000 }).catch(() => {})
      // An empty, unmounted directory can be removed; a live mount or unexpected
      // contents are left intact and reported rather than traversed/deleted.
      await rmdir(mount)
    }
  } catch {
    failure ??= new Error('UPDATE_UNMOUNT_FAILED')
  }
  if (failure || !prepared) {
    await cleanup()
    throw failure ?? new Error('UPDATE_INSTALL_INVALID')
  }
  return prepared
}

export function readInstallerFailure(root: string): string | undefined {
  const file = join(root, 'last-install-result')
  try {
    if (statSync(file).size > 128) return 'UPDATE_INSTALL_INVALID'
    const result = readFileSync(file, 'utf8').trim()
    rmSync(file, { force: true })
    return [
      'UPDATE_INSTALL_INVALID',
      'UPDATE_QUIT_TIMEOUT',
      'UPDATE_REPLACE_FAILED',
      'UPDATE_ROLLBACK_FAILED',
      'UPDATE_RESTART_FAILED',
    ].includes(result)
      ? result
      : undefined
  } catch {
    return undefined
  }
}
