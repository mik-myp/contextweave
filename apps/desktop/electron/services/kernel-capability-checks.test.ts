import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { KernelCapabilities } from '@contextweave/contracts'
import { checkKernelCapabilities, type ProbeSend } from './kernel-capability-checks'
const capabilities: KernelCapabilities = {
  cdp: true,
  screenshot: true,
  elementScreenshot: true,
  fileUpload: true,
  userAgent: true,
  timezone: true,
  proxy: true,
  webRtcPolicy: true,
}
function fixture() {
  let timezone = 'Asia/Tokyo'
  const send = vi.fn<ProbeSend>(async (method, params) => {
    if (method === 'Browser.getVersion') return { product: 'Chrome/123.0.0.1' }
    if (method === 'Target.createTarget') return { targetId: 'one' }
    if (method === 'Target.attachToTarget') return { sessionId: 'page' }
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
    if (method === 'Page.captureScreenshot') {
      const clip = z.object({ width: z.number(), height: z.number() }).parse(params?.clip)
      const bytes = Buffer.alloc(33)
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
      bytes.writeUInt32BE(13, 8)
      bytes.write('IHDR', 12)
      bytes.writeUInt32BE(clip.width, 16)
      bytes.writeUInt32BE(clip.height, 20)
      return { data: bytes.toString('base64') }
    }
    if (method === 'Emulation.setTimezoneOverride') timezone = String(params?.timezoneId)
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelector') return { nodeId: 2 }
    if (method === 'Runtime.evaluate') {
      const expression = String(params?.expression)
      return {
        result: {
          value: expression.includes('getBoundingClientRect')
            ? { x: 0, y: 0, width: 40, height: 30 }
            : expression.includes('files.length')
              ? 1
              : expression === 'navigator.userAgent'
                ? 'ContextWeave-Offline-Probe/1.0'
                : timezone,
        },
      }
    }
    return {}
  })
  return send
}
it('records versioned observed evidence for offline checks, not network capability declarations', async () => {
  const send = fixture()
  const result = await checkKernelCapabilities(
    capabilities,
    send,
    '/fixture/only.txt',
    new AbortController().signal,
  )
  for (const key of [
    'cdp',
    'screenshot',
    'elementScreenshot',
    'fileUpload',
    'userAgent',
    'timezone',
  ])
    expect(result.report[key]).toMatchObject({
      state: 'verified',
      version: 'Chrome/123.0.0.1',
      checkedAt: expect.any(String),
      evidence: expect.stringContaining('offline-probe'),
    })
  for (const key of ['proxy', 'webRtcPolicy']) expect(result.report[key].state).toBe('unverified')
  expect(send.mock.calls).toContainEqual(['Network.setBlockedURLs', { urls: ['*'] }, 'page'])
  expect(send.mock.calls).toContainEqual([
    'DOM.setFileInputFiles',
    { nodeId: 2, files: ['/fixture/only.txt'] },
    'page',
  ])
})
it('does not promote unsupported declarations and isolates failed checks without exposing raw errors', async () => {
  const original = fixture(),
    send = vi.fn<ProbeSend>(async (method, params, session) => {
      if (method === 'Page.captureScreenshot') throw new Error('/private/secret')
      return original(method, params, session)
    })
  const result = await checkKernelCapabilities(
    { ...capabilities, userAgent: false },
    send,
    '/fixture/only.txt',
    new AbortController().signal,
  )
  expect(result.report.screenshot.state).toBe('failed')
  expect(result.report.elementScreenshot.state).toBe('failed')
  expect(result.report.userAgent.state).toBe('unsupported')
  expect(result.report.timezone.state).toBe('verified')
  expect(JSON.stringify(result)).not.toContain('secret')
})
it('stops on cancellation and rejects a missing version instead of inventing evidence', async () => {
  const abort = new AbortController(),
    send = fixture()
  abort.abort()
  await expect(
    checkKernelCapabilities(capabilities, send, '/fixture/only.txt', abort.signal),
  ).rejects.toThrow()
  expect(send).not.toHaveBeenCalled()
  await expect(
    checkKernelCapabilities(
      capabilities,
      async () => ({}),
      'fixture',
      new AbortController().signal,
    ),
  ).rejects.toThrow()
})

it('preserves the observed CDP handshake when a page capability setup fails', async () => {
  const original = fixture()
  const result = await checkKernelCapabilities(
    capabilities,
    async (method, params, session) => {
      if (method === 'Page.enable') throw new Error('/private/setup-error')
      return original(method, params, session)
    },
    '/fixture/only.txt',
    new AbortController().signal,
  )
  expect(result.report.cdp.state).toBe('verified')
  expect(result.report.screenshot.state).toBe('failed')
  expect(result.report.proxy.state).toBe('unverified')
  expect(JSON.stringify(result)).not.toContain('setup-error')
})
it('rejects a no-op timezone override and a screenshot with the wrong clip dimensions', async () => {
  const original = fixture()
  const result = await checkKernelCapabilities(
    capabilities,
    async (method, params, session) => {
      if (method === 'Emulation.setTimezoneOverride') return {}
      if (method === 'Page.captureScreenshot')
        return original(method, { ...params, clip: { width: 1, height: 1 } }, session)
      return original(method, params, session)
    },
    '/fixture/only.txt',
    new AbortController().signal,
  )
  expect(result.report.timezone.state).toBe('failed')
  expect(result.report.screenshot.state).toBe('failed')
  expect(result.report.elementScreenshot.state).toBe('failed')
  expect(result.report.userAgent.state).toBe('verified')
})
