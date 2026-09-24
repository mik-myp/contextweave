import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import {
  maxWorkerScreenshotBytes,
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
    if (size > 1024 * 1024) throw new Error('WORKER_INPUT_LIMIT')
    chunks.push(Buffer.from(chunk))
  }
  return workerProcessRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

async function run(): Promise<WorkerProcessResult> {
  const payload = await readPayload()
  request = payload
  const task = payload.task
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${payload.controlPort}`)
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages()[0] ?? (await context.newPage())
    let cdpSession: Awaited<ReturnType<typeof context.newCDPSession>> | undefined
    if (payload.proxyCredentials) {
      cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Fetch.enable', { handleAuthRequests: true })
      cdpSession.on(
        'Fetch.authRequired',
        (event: { requestId: string; authChallenge: { source?: string } }) => {
          if (event.authChallenge.source !== 'Proxy') return
          void cdpSession?.send('Fetch.continueWithAuth', {
            requestId: event.requestId,
            authChallengeResponse: {
              response: 'ProvideCredentials',
              username: payload.proxyCredentials?.username,
              password: payload.proxyCredentials?.password,
            },
          })
        },
      )
    }
    await page.goto(task.input.url, {
      waitUntil: 'domcontentloaded',
      timeout: task.input.timeoutMs,
    })
    const title = await page.title()
    // Never give Playwright a path derived from task input. Main opened this descriptor.
    const screenshot = await page.screenshot({ type: 'png', fullPage: false })
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
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Worker failed'
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
