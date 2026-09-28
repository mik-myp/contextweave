import { z } from 'zod'
import type { CapabilityEvidence, KernelCapabilities } from '@contextweave/contracts'

export type ProbeSend = (
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
) => Promise<Record<string, unknown>>
/** Every verified result corresponds to an observation, never merely a manifest flag. */
export async function checkKernelCapabilities(
  capabilities: KernelCapabilities,
  send: ProbeSend,
  uploadFile: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const checkedAt = new Date().toISOString()
  const report: Record<string, CapabilityEvidence> = Object.fromEntries(
    Object.entries(capabilities).map(([key, declared]) => [
      key,
      { declared, state: declared ? 'unverified' : 'unsupported' },
    ]),
  )
  const { product: version } = z
    .object({ product: z.string().min(1).max(200) })
    .parse(await send('Browser.getVersion'))
  const verified = (key: keyof KernelCapabilities, evidence: string) => {
    if (capabilities[key])
      report[key] = { declared: true, state: 'verified', version, checkedAt, evidence }
  }
  verified('cdp', 'offline-probe:cdp-handshake:v1')
  signal.throwIfAborted()
  let sessionId: string
  try {
    const { targetId } = z
      .object({ targetId: z.string() })
      .parse(await send('Target.createTarget', { url: 'about:blank' }))
    const attached = z
      .object({ sessionId: z.string() })
      .parse(await send('Target.attachToTarget', { targetId, flatten: true }))
    sessionId = attached.sessionId
    const pageSend: ProbeSend = (method, params) => send(method, params, sessionId)
    await pageSend('Page.enable')
    await pageSend('Network.enable')
    await pageSend('Network.setBlockedURLs', { urls: ['*'] })
    const { frameTree } = z
      .object({ frameTree: z.object({ frame: z.object({ id: z.string() }) }) })
      .parse(await pageSend('Page.getFrameTree'))
    await pageSend('Page.setDocumentContent', {
      frameId: frameTree.frame.id,
      html: '<!doctype html><html><body><div id="fixture" style="width:40px;height:30px;background:#123456"></div><input id="upload" type="file"></body></html>',
    })
  } catch {
    signal.throwIfAborted()
    for (const key of [
      'screenshot',
      'elementScreenshot',
      'fileUpload',
      'userAgent',
      'timezone',
    ] as const) {
      if (capabilities[key])
        report[key] = {
          declared: true,
          state: 'failed',
          version,
          checkedAt,
          evidence: 'offline-probe:page-setup-failed:v1',
        }
    }
    return { version, checkedAt, report }
  }
  const pageSend: ProbeSend = (method, params) => send(method, params, sessionId)
  const evaluate = async (expression: string) => {
    const result = z
      .object({
        result: z.object({ value: z.unknown() }),
        exceptionDetails: z.unknown().optional(),
      })
      .parse(await pageSend('Runtime.evaluate', { expression, returnByValue: true }))
    if (result.exceptionDetails) throw new Error('KERNEL_PROBE_FAILED')
    return result.result.value
  }
  const run = async (
    key: keyof KernelCapabilities,
    check: () => Promise<void>,
    evidence: string,
  ) => {
    if (!capabilities[key]) return
    signal.throwIfAborted()
    try {
      await check()
      verified(key, evidence)
    } catch {
      signal.throwIfAborted()
      report[key] = {
        declared: true,
        state: 'failed',
        version,
        checkedAt,
        evidence: 'offline-probe:check-failed:v1',
      }
    }
  }
  const png = (result: unknown, width: number, height: number) => {
    const { data } = z.object({ data: z.string().min(32) }).parse(result)
    const bytes = Buffer.from(data, 'base64')
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== width ||
      bytes.readUInt32BE(20) !== height
    )
      throw new Error('KERNEL_PROBE_FAILED')
  }
  await run(
    'screenshot',
    async () => {
      png(
        await pageSend('Page.captureScreenshot', {
          format: 'png',
          clip: { x: 0, y: 0, width: 64, height: 64, scale: 1 },
        }),
        64,
        64,
      )
    },
    'offline-probe:page-png:v1',
  )
  await run(
    'elementScreenshot',
    async () => {
      const bounds = z
        .object({ x: z.number(), y: z.number(), width: z.literal(40), height: z.literal(30) })
        .parse(
          await evaluate(
            'JSON.parse(JSON.stringify(document.getElementById("fixture").getBoundingClientRect()))',
          ),
        )
      png(
        await pageSend('Page.captureScreenshot', { format: 'png', clip: { ...bounds, scale: 1 } }),
        40,
        30,
      )
    },
    'offline-probe:element-clip-png:v1',
  )
  await run(
    'fileUpload',
    async () => {
      const { root } = z
        .object({ root: z.object({ nodeId: z.number() }) })
        .parse(await pageSend('DOM.getDocument'))
      const { nodeId } = z
        .object({ nodeId: z.number().positive() })
        .parse(await pageSend('DOM.querySelector', { nodeId: root.nodeId, selector: '#upload' }))
      await pageSend('DOM.setFileInputFiles', { nodeId, files: [uploadFile] })
      if ((await evaluate('document.getElementById("upload").files.length')) !== 1)
        throw new Error('KERNEL_PROBE_FAILED')
    },
    'offline-probe:temporary-file-input:v1',
  )
  await run(
    'userAgent',
    async () => {
      await pageSend('Emulation.setUserAgentOverride', {
        userAgent: 'ContextWeave-Offline-Probe/1.0',
      })
      if ((await evaluate('navigator.userAgent')) !== 'ContextWeave-Offline-Probe/1.0')
        throw new Error('KERNEL_PROBE_FAILED')
    },
    'offline-probe:user-agent-override:v1',
  )
  await run(
    'timezone',
    async () => {
      for (const timezoneId of ['UTC', 'Asia/Tokyo']) {
        await pageSend('Emulation.setTimezoneOverride', { timezoneId })
        if ((await evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone')) !== timezoneId)
          throw new Error('KERNEL_PROBE_FAILED')
      }
    },
    'offline-probe:timezone-override:v1',
  )
  // Proxy routing/authentication and WebRTC leakage need dedicated network scenarios.
  signal.throwIfAborted()
  return { version, checkedAt, report }
}
