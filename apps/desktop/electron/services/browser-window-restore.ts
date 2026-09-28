import { spawn } from 'node:child_process'
import type { LaunchPlan } from '@contextweave/kernel-core'

/** Forward startup to the already-owned Chromium singleton only after CDP is configured.
 * No shell, credentials or new control port. The original process still owns the profile lock.
 */
export async function restoreBrowserWindows(plan: LaunchPlan, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const args = plan.args.filter(
    (arg) => arg !== '--no-startup-window' && !arg.startsWith('--remote-debugging-'),
  )
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.executablePath, args, { stdio: 'ignore', windowsHide: true })
    let settled = false
    let failed = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (success: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal.removeEventListener('abort', abort)
      if (success && !failed && !signal.aborted) resolve()
      else reject(new Error('BROWSER_RESTORE_FAILED'))
    }
    const abort = () => {
      if (settled || failed) return
      failed = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000)
    }
    // A singleton handoff should exit promptly, never become an untracked browser.
    const timer = setTimeout(abort, 10000)
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', () => finish(false))
    child.once('exit', (code) => finish(code === 0))
    if (signal.aborted) abort()
  })
}
