import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Unknown/permission failures are not proof of death.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** OS start identity, not the time the application happened to observe the PID. */
export function readProcessIdentity(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      if (ticks && /^\d+$/.test(ticks)) return `linux:${boot}:${ticks}`
    } else if (process.platform === 'darwin') {
      const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 4096,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (/^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}$/.test(start))
        return `darwin:${start}`
    } else if (process.platform === 'win32') {
      const shell = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      const start = execFileSync(
        shell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='Stop'; (Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks.ToString()`,
        ],
        {
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 4096,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim()
      if (/^\d+$/.test(start)) return `win32:${start}`
    }
  } catch {
    /* Missing permission or an exited process is resolved conservatively by the caller. */
  }
  return undefined
}

export function isRuntimeProcessAlive(pid: number, identity?: string): boolean {
  if (!isProcessAlive(pid)) return false
  if (!identity) return true // Legacy records must not authorize killing or reclaiming a live PID.
  const current = readProcessIdentity(pid)
  return current === undefined || current === identity
}
