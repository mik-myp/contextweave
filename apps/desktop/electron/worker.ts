import { browserControlUrl } from './services/browser-control-access'
import { createWorkerChannel } from './services/worker-channel'
import { chromium } from 'playwright-core'
import type { WorkerProcessRequest, WorkerProcessResult } from '@contextweave/worker-protocol'

let request: WorkerProcessRequest | undefined
const channel = createWorkerChannel(process.parentPort)

async function run(): Promise<WorkerProcessResult> {
  const payload = await channel.request()
  request = payload
  const task = payload.task
  const browser = await chromium.connectOverCDP(browserControlUrl(payload.control), {
    headers: { Authorization: `Bearer ${payload.control.token}` },
    timeout: Math.min(task.input.timeoutMs, 15000),
  })
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages()[0] ?? (await context.newPage())
    // Proxy authentication is owned by Main's runtime/bridge, never by a worker task.
    // Headful Chromium may defer screenshot composition for a background tab on Windows.
    await page.bringToFront()
    await page.goto(task.input.url, {
      waitUntil: 'domcontentloaded',
      timeout: task.input.timeoutMs,
    })
    const title = (await page.title()).slice(0, 4096)
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      timeout: task.input.timeoutMs,
    })
    // Main owns the output file. The child receives no path or inherited writable fd.
    await channel.screenshot(screenshot)
    return {
      protocolVersion: task.protocolVersion,
      taskId: task.taskId,
      environmentId: task.environmentId,
      ok: true,
      title,
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  let result: WorkerProcessResult
  try {
    result = await run()
  } catch {
    // Request/connection errors may contain credentials or headers. Never serialize them.
    if (!request) return process.exit(1)
    result = {
      protocolVersion: request.task.protocolVersion,
      taskId: request.task.taskId,
      environmentId: request.task.environmentId,
      ok: false,
      errorCode: 'WORKER_ERROR',
      errorMessage: 'Worker execution failed',
    }
  }
  try {
    await channel.result(result)
    // The result was received by Main; it still waits for this actual exit before succeeding.
    process.exit(result.ok ? 0 : 1)
  } catch {
    process.exit(1)
  }
}
void main()
