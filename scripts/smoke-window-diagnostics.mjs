// Test-host-only OS sampling. Raw native stacks never enter logs or release artifacts.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const maxBytes = 2 * 1024 * 1024
const categories = {
  inspector: /v8_inspector|V8InspectorSession|NodeInspectorClient|[Rr]unMessageLoopOnPause/,
  cocoaLoop: /CFRunLoopRun|nextEventMatchingMask|DPSNextEvent|NSApplication run/,
  nativeWindow: /NSWindow|BrowserWindow|NativeWindowMac/,
  singleInstance: /ProcessSingleton|NotifyOtherProcess|SingletonSocket|SocketReader/,
  keychain: /SecItemCopyMatching|SecKeychain|securityd/,
  disk: /fsync|pread|pwrite|sqlite3|fdatasync/,
  libuv: /uv__io_poll|uv_run|kevent/,
  mach: /mach_msg|semaphore_wait_trap/,
}
export function classifyWindowSample(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes)
    return { status: 'unavailable' }
  const frames = Object.fromEntries(Object.keys(categories).map((key) => [key, 0]))
  for (const line of text.split('\n')) {
    // Only stack-frame rows count; paths, arguments, binary images and metadata do not.
    const frame = /^\s*\+?\s*\d+\s+(.+)/.exec(line)?.[1]?.split(' (in ')[0]
    if (!frame) continue
    for (const [name, pattern] of Object.entries(categories))
      if (pattern.test(frame)) frames[name] = Math.min(255, frames[name] + 1)
  }
  return { status: 'sampled', frames }
}
export async function sampleOwnedMain(child, platform = process.platform, run = execute) {
  if (platform !== 'darwin') return { status: 'unsupported' }
  if (
    !child ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 0 ||
    child.pid > 2147483647 ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return { status: 'unavailable' }
  let directory,
    result = { status: 'unavailable' }
  try {
    directory = await mkdtemp(join(tmpdir(), 'cw-owned-main-sample-'))
    const path = join(directory, 'sample.txt')
    await run('/usr/bin/sample', [String(child.pid), '1', '10', '-file', path], {
      timeout: 3000,
      maxBuffer: 65536,
      windowsHide: true,
    })
    if (child.exitCode === null && child.signalCode === null && (await stat(path)).size <= maxBytes)
      result = classifyWindowSample(await readFile(path, 'utf8'))
  } catch {
    /* No raw process/sample error is retained. */
  } finally {
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true })
      } catch {
        result = { status: 'unavailable' }
      }
    }
  }
  return result
}
