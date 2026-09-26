import { execFile } from 'node:child_process'
import { mkdtemp, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
type DmgCommand = (
  file: string,
  args: string[],
  options: { signal?: AbortSignal; timeout: number },
) => Promise<unknown>

/** The mount and its backing archive may still be in use: neither may be swept. */
export class KernelDmgCleanupError extends Error {
  constructor() {
    super('ARCHIVE_UNMOUNT_FAILED')
  }
}

/** Only Main-owned verified archives and a private read/copy callback reach this boundary. */
export async function withKernelDmg(
  archive: string,
  stage: string,
  signal: AbortSignal,
  read: (mount: string) => Promise<void>,
  run: DmgCommand = execute,
): Promise<void> {
  signal.throwIfAborted()
  // Keep the mount OUTSIDE the tree the installation finally may recursively delete.
  const mount = await mkdtemp(join(dirname(stage), '.kernel-mount-'))
  let failure: { cause: unknown } | undefined
  try {
    try {
      signal.throwIfAborted()
      await run(
        '/usr/bin/hdiutil',
        ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, archive],
        { signal, timeout: 60000 },
      )
    } catch {
      signal.throwIfAborted()
      throw new Error('ARCHIVE_MOUNT_FAILED')
    }
    signal.throwIfAborted()
    await read(mount)
  } catch (cause) {
    failure = { cause }
  }
  // Even failed/aborted attach can have mounted. Cleanup must outlive cancellation.
  await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000 }).catch(() => {})
  try {
    // rmdir cannot traverse a live mounted volume (EBUSY on macOS), nor unknown contents.
    // A detach error alone may mean attach never mounted; an empty directory is safe.
    await rmdir(mount)
  } catch {
    throw new KernelDmgCleanupError()
  }
  if (failure) throw failure.cause
}
