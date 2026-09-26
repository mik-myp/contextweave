import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Read-only and cancellable: cold shell startup must never block Electron's event loop. */
export async function readProcessIdentityAsync(
  pid: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  signal?.throwIfAborted()
  try {
    if (process.platform === 'linux') {
      const [stat, boot] = await Promise.all([
        readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal }),
        readFile('/proc/sys/kernel/random/boot_id', { encoding: 'utf8', signal }),
      ])
      const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
      if (ticks && /^\d+$/.test(ticks)) return `linux:${boot.trim()}:${ticks}`
      return undefined
    }
    const windows = process.platform === 'win32'
    if (!windows && process.platform !== 'darwin') return undefined
    const file = windows
      ? join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        )
      : '/bin/ps'
    const args = windows
      ? [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks.ToString()`,
        ]
      : ['-p', String(pid), '-o', 'lstart=']
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        file,
        args,
        {
          encoding: 'utf8',
          timeout: windows ? 5000 : 2000,
          maxBuffer: 4096,
          windowsHide: true,
          signal,
          env: windows ? process.env : { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      )
    })
    const start = stdout.trim()
    if (
      windows
        ? /^\d+$/.test(start)
        : /^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}$/.test(start)
    )
      return `${process.platform}:${start}`
  } catch {
    signal?.throwIfAborted()
    // A retry/ownership decision belongs to the supervisor, never to the OS probe.
  }
  return undefined
}
