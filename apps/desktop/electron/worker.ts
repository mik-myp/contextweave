import { browserControlUrl } from './services/browser-control-access'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import {
  maxWorkerScreenshotBytes,
  maxWorkerProtocolBytes,
  workerProcessRequestSchema,
  workerScreenshotDescriptor,
  type WorkerProcessRequest,
  type WorkerProcessResult,
} from '@contextweave/worker-protocol'

let request: WorkerProcessRequest | undefined

async function readPayload(): Promise<WorkerProcessRequest> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > maxWorkerProtocolBytes) throw new Error('WORKER_INPUT_LIMIT')
    chunks.push(Buffer.from(chunk))
  }
  return workerProcessRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

async function run(): Promise<WorkerProcessResult> {
  const payload = await readPayload()
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
    // Restored sessions may contain multiple tabs. Headful Chromium can defer
    // screenshot composition for a background tab, especially on Windows.
    // Activate the page this Worker actually selected, not another CDP client's first page.
    await page.bringToFront()
    await page.goto(task.input.url, {
      waitUntil: 'domcontentloaded',
      timeout: task.input.timeoutMs,
    })
    const title = await page.title()
    // Never give Playwright a path derived from task input. Main opened this descriptor.
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      timeout: task.input.timeoutMs,
    })
    if (screenshot.length > maxWorkerScreenshotBytes) throw new Error('WORKER_OUTPUT_LIMIT')
    writeFileSync(workerScreenshotDescriptor, screenshot)
    return {
      protocolVersion: task.protocolVersion,
      taskId: task.taskId,
      environmentId: task.environmentId,
      ok: true,
      title,
    }
  } finally {
    // The CDP connection is detached with the browser connection below.
    await browser.close()
  }
}

run()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(0)
  })
  .catch(() => {
    // Connection errors can contain request headers; never serialize private transport metadata.
    const message = 'Worker execution failed'
    const result: WorkerProcessResult = {
      protocolVersion: 1,
      taskId: request?.task.taskId ?? 'unknown',
      environmentId: request?.task.environmentId ?? 'unknown',
      ok: false,
      errorCode: 'WORKER_ERROR',
      errorMessage: message,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(1)
  })
