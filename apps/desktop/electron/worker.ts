import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { workerTaskSchema, type WorkerResult } from '@contextweave/worker-protocol'

type WorkerProxyCredentials = { username: string; password: string }
type WorkerPayload = {
  task: unknown
  controlPort: number
  proxyCredentials?: WorkerProxyCredentials
}

async function readPayload(): Promise<WorkerPayload> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const rawPayload = Buffer.concat(chunks).toString('utf8')
  if (!rawPayload) throw new Error('Worker payload is missing')
  return JSON.parse(rawPayload) as WorkerPayload
}

async function run(): Promise<WorkerResult> {
  const payload = await readPayload()
  const task = workerTaskSchema.parse(payload.task)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${payload.controlPort}`)
  try {
    const context = browser.contexts()[0] ?? await browser.newContext()
    const page = context.pages()[0] ?? await context.newPage()
    let cdpSession: Awaited<ReturnType<typeof context.newCDPSession>> | undefined
    if (payload.proxyCredentials) {
      cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Fetch.enable', { handleAuthRequests: true })
      cdpSession.on('Fetch.authRequired', (event: {
        requestId: string
        authChallenge: { source?: string }
      }) => {
        if (event.authChallenge.source !== 'Proxy') return
        void cdpSession?.send('Fetch.continueWithAuth', {
          requestId: event.requestId,
          authChallengeResponse: {
            response: 'ProvideCredentials',
            username: payload.proxyCredentials?.username,
            password: payload.proxyCredentials?.password,
          },
        })
      })
    }
    await page.goto(task.input.url, { waitUntil: 'domcontentloaded', timeout: task.input.timeoutMs })
    const title = await page.title()
    const screenshotPath = task.input.screenshotPath ?? join(tmpdir(), `${task.taskId}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: false })
    return {
      protocolVersion: task.protocolVersion,
      taskId: task.taskId,
      environmentId: task.environmentId,
      ok: true,
      title,
      screenshotPath,
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
    const result: WorkerResult = {
      protocolVersion: 1,
      taskId: 'unknown',
      environmentId: 'unknown',
      ok: false,
      errorCode: 'WORKER_ERROR',
      errorMessage: message,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(1)
  })
