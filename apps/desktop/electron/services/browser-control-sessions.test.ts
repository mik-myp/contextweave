import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlFixture } from './fixtures/browser-control'
import { createControlPipe, type ControlMessage } from './browser-control-pipe'
import { createControlSessions } from './browser-control-sessions'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0).reverse()) clean()
})
async function fixture(sessionLimit = 1024) {
  const browser = controlFixture()
  const pipe = createControlPipe(browser.input, browser.output)
  const routing = createControlSessions(pipe, sessionLimit)
  cleanups.push(pipe.close, routing.close)
  const messagesA: ControlMessage[] = [],
    messagesB: ControlMessage[] = []
  const terminateA = vi.fn(),
    terminateB = vi.fn()
  const a = routing.connect((m) => messagesA.push(m), terminateA)
  const b = routing.connect((m) => messagesB.push(m), terminateB)
  await Promise.all([a.ready, b.ready])
  return { browser, pipe, routing, a, b, messagesA, messagesB, terminateA, terminateB }
}
const encode = (method: string, params: Record<string, unknown> = {}, sessionId?: string, id = 1) =>
  JSON.stringify({ method, params, sessionId, id })

describe('isolated browser control sessions', () => {
  it('rewrites request IDs and routes events without broadcasting root or peer events', async () => {
    const { a, b, browser, messagesA, messagesB } = await fixture()
    await Promise.all([
      a.receive(encode('Browser.getVersion')),
      b.receive(encode('Browser.getVersion')),
    ])
    expect(
      browser.commands.filter((m) => m.method === 'Browser.getVersion').map((m) => m.sessionId),
    ).toEqual(['root-1', 'root-2'])
    expect(messagesA[0].id).toBe(1)
    expect(messagesB[0].id).toBe(1)
    browser.emit({ method: 'Target.targetCreated', sessionId: 'root-1', params: { secret: 'A' } })
    browser.emit({
      method: 'Target.targetCreated',
      sessionId: 'unknown',
      params: { secret: 'outside' },
    })
    browser.emit({ method: 'Target.targetCreated', params: { secret: 'global' } })
    expect(messagesA.at(-1)).toEqual({
      method: 'Target.targetCreated',
      params: { secret: 'A' },
      sessionId: undefined,
    })
    expect(messagesB).toHaveLength(1)
  })
  it.each([
    encode('Runtime.evaluate', {}, 'root-2'),
    encode('Runtime.evaluate', {}, 'never-owned'),
    encode('Target.detachFromTarget', { sessionId: 'never-owned' }),
    encode('Target.detachFromTarget', { sessionId: 'root-2' }),
    encode('Target.detachFromTarget', { targetId: 'foreign-target' }),
    encode('Target.detachFromTarget', { sessionId: 'root-1' }),
    encode('Target.sendMessageToTarget', { message: 'hidden', sessionId: 'root-2' }),
    encode('Target.exposeDevToolsProtocol', { targetId: 'page' }),
    encode('Target.attachToTarget', { targetId: 'page', flatten: false }),
    encode('Target.setAutoAttach', { autoAttach: true, flatten: false }),
    JSON.stringify({ id: 1, method: 'Browser.getVersion', hidden: true }),
  ])(
    'rejects foreign/legacy/ambiguous commands while preserving a different client',
    async (text) => {
      const { a, b, pipe, browser, messagesB, terminateA, terminateB } = await fixture()
      await a.receive(text)
      expect(terminateA).toHaveBeenCalledOnce()
      expect(
        browser.commands
          .filter((m) => m.method === 'Target.detachFromTarget')
          .map((m) => m.params?.sessionId),
      ).toEqual(['root-1'])
      await b.receive(encode('Browser.getVersion'))
      expect(messagesB.at(-1)?.result?.product).toBe('Chrome/123.0.0.1')
      expect(pipe.closed).toBe(false)
      expect(terminateB).not.toHaveBeenCalled()
    },
  )
  it('owns descendants and explicit browser roots, and detaches only this client on close', async () => {
    const { a, b, browser, messagesA, terminateA, terminateB } = await fixture()
    await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
    const page = messagesA.at(-1)?.result?.sessionId
    expect(page).toBe('page-3')
    await a.receive(encode('Runtime.evaluate', {}, String(page), 2))
    await a.receive(encode('Target.attachToBrowserTarget', {}, undefined, 3))
    a.close()
    a.close()
    expect(
      browser.commands
        .filter((m) => m.method === 'Target.detachFromTarget')
        .map((m) => m.params?.sessionId),
    ).toEqual(['root-1', 'root-4'])
    expect(terminateA).toHaveBeenCalledOnce()
    expect(terminateB).not.toHaveBeenCalled()
    await b.receive(encode('Browser.getVersion'))
  })
  it('removes detached descendant trees and rejects their subsequent reuse', async () => {
    const { a, browser, messagesA, terminateA } = await fixture()
    await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
    browser.emit({
      method: 'Target.attachedToTarget',
      sessionId: 'page-3',
      params: { sessionId: 'frame-4' },
    })
    browser.emit({
      method: 'Target.detachedFromTarget',
      sessionId: 'root-1',
      params: { sessionId: 'page-3' },
    })
    await a.receive(encode('Runtime.evaluate', {}, 'frame-4'))
    expect(terminateA).not.toHaveBeenCalled()
    expect(messagesA.at(-1)?.error?.code).toBe(-32001)
    expect(
      browser.commands.filter((message) => message.method === 'Runtime.evaluate'),
    ).toHaveLength(0)
  })
  it('rejects duplicate in-flight IDs and cancels pending work when a client disconnects', async () => {
    const { a, b, browser, pipe, terminateA } = await fixture()
    browser.handle((message) => message.method === 'Page.navigate')
    const pending = a.receive(encode('Page.navigate'))
    await a.receive(encode('Page.navigate'))
    await pending
    expect(terminateA).toHaveBeenCalledOnce()
    expect(pipe.closed).toBe(false)
    await b.receive(encode('Browser.getVersion'))
  })
  it('detaches an attach response that arrives after connection revocation', async () => {
    const { browser, routing, pipe } = await fixture()
    browser.handle((message) => message.method === 'Target.attachToBrowserTarget')
    const closed = vi.fn(),
      client = routing.connect(vi.fn(), closed)
    const id = browser.commands.at(-1)?.id
    client.close()
    browser.emit({ id, result: { sessionId: 'late-root' } })
    await client.ready
    expect(closed).toHaveBeenCalledOnce()
    expect(browser.commands.at(-1)).toMatchObject({
      method: 'Target.detachFromTarget',
      params: { sessionId: 'late-root' },
    })
    expect(pipe.closed).toBe(false)
  })
})

it('closes only the owner when Chromium detaches its browser root', async () => {
  const { a, b, browser, pipe, terminateA, terminateB } = await fixture()
  browser.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'root-1' } })
  expect(terminateA).toHaveBeenCalledOnce()
  expect(terminateB).not.toHaveBeenCalled()
  expect(pipe.closed).toBe(false)
  await a.receive(encode('Browser.getVersion'))
  await b.receive(encode('Browser.getVersion'))
})
it('caps extra browser roots while leaving a peer connected and detaches all owned roots', async () => {
  const { a, b, browser, pipe, terminateA } = await fixture()
  for (let i = 0; i < 8; i++)
    await a.receive(encode('Target.attachToBrowserTarget', {}, undefined, i))
  expect(terminateA).toHaveBeenCalledOnce()
  expect(browser.commands.filter((m) => m.method === 'Target.detachFromTarget')).toHaveLength(8)
  expect(pipe.closed).toBe(false)
  await b.receive(encode('Browser.getVersion'))
})
it('removes explicit root attachments even when no parent-session detach event is emitted', async () => {
  const { a, browser, messagesA, terminateA } = await fixture()
  await a.receive(encode('Target.attachToBrowserTarget'))
  await a.receive(encode('Target.detachFromTarget', { sessionId: 'root-3' }, undefined, 2))
  await a.receive(encode('Browser.getVersion', {}, 'root-3', 3))
  expect(terminateA).not.toHaveBeenCalled()
  expect(messagesA.at(-1)?.error?.code).toBe(-32001)
  expect(browser.commands.filter((m) => m.method === 'Browser.getVersion')).toHaveLength(0)
})

it('queues bursts rather than disconnecting profiles with many restored tabs', async () => {
  const { a, b, browser, pipe, terminateA } = await fixture()
  const waiting: ControlMessage[] = []
  browser.handle((message) => {
    if (message.method === 'Runtime.evaluate') {
      waiting.push(message)
      return true
    }
    return false
  })
  const requests = Array.from({ length: 60 }, (_, id) =>
    a.receive(encode('Runtime.evaluate', {}, undefined, id)),
  )
  expect(waiting).toHaveLength(24)
  while (waiting.length) {
    const batch = waiting.splice(0)
    for (const message of batch) browser.emit({ id: message.id, result: {} })
    await Promise.resolve()
    await Promise.resolve()
  }
  await Promise.all(requests)
  expect(browser.commands.filter((m) => m.method === 'Runtime.evaluate')).toHaveLength(60)
  expect(terminateA).not.toHaveBeenCalled()
  expect(pipe.closed).toBe(false)
  await b.receive(encode('Browser.getVersion'))
})
it('bounds the queue and never sends queued work after a client has been revoked', async () => {
  const { a, browser, pipe, terminateA } = await fixture()
  browser.handle((message) => message.method === 'Runtime.evaluate')
  const requests = Array.from({ length: 129 }, (_, id) =>
    a.receive(encode('Runtime.evaluate', {}, undefined, id)),
  )
  await Promise.all(requests)
  expect(terminateA).toHaveBeenCalledOnce()
  expect(browser.commands.filter((m) => m.method === 'Runtime.evaluate')).toHaveLength(24)
  expect(pipe.closed).toBe(false)
})
it('fails closed before an unbounded target session tree can be allocated', async () => {
  const browser = controlFixture(),
    pipe = createControlPipe(browser.input, browser.output)
  const routing = createControlSessions(pipe, 2)
  cleanups.push(pipe.close, routing.close)
  const terminate = vi.fn(),
    a = routing.connect(vi.fn(), terminate)
  await a.ready
  await a.receive(encode('Target.attachToTarget', { targetId: 'page-1', flatten: true }))
  await a.receive(
    encode('Target.attachToTarget', { targetId: 'page-2', flatten: true }, undefined, 2),
  )
  expect(pipe.closed).toBe(true)
  expect(terminate).toHaveBeenCalledOnce()
})

it('rejects a late command to an owned detached page without disconnecting healthy sessions', async () => {
  const { a, b, browser, pipe, messagesA, terminateA, terminateB } = await fixture()
  await a.receive(encode('Target.attachToTarget', { targetId: 'closing-page', flatten: true }))
  browser.emit({
    method: 'Target.detachedFromTarget',
    sessionId: 'root-1',
    params: { sessionId: 'page-3' },
  })
  await a.receive(encode('Runtime.evaluate', { expression: '1' }, 'page-3', 2))
  expect(messagesA.at(-1)).toEqual({
    id: 2,
    sessionId: 'page-3',
    error: { code: -32001, message: 'Session with given id not found.' },
  })
  expect(browser.commands.filter((message) => message.method === 'Runtime.evaluate')).toHaveLength(
    0,
  )
  expect(terminateA).not.toHaveBeenCalled()
  expect(terminateB).not.toHaveBeenCalled()
  expect(pipe.closed).toBe(false)
  await a.receive(encode('Browser.getVersion', {}, undefined, 3))
  expect(messagesA.at(-1)?.result).toEqual({ product: 'Chrome/123.0.0.1' })
  await b.receive(encode('Browser.getVersion'))
})

it.each(['detached', 'evicted', 'reused'])(
  'rejects queued commands whose admitted session is %s without forwarding or disconnecting',
  async (state) => {
    const { a, browser, messagesA, terminateA } = await fixture(3)
    await a.receive(encode('Target.attachToTarget', { targetId: 'closing-page', flatten: true }))
    const waiting: ControlMessage[] = []
    browser.handle((message) => {
      if (message.method !== 'Browser.getVersion') return false
      waiting.push(message)
      return true
    })
    const active = Array.from({ length: 24 }, (_, index) =>
      a.receive(encode('Browser.getVersion', {}, undefined, index + 10)),
    )
    const queued = a.receive(encode('Runtime.evaluate', { expression: '1' }, 'page-3', 100))
    expect(waiting).toHaveLength(24)
    browser.emit({
      method: 'Target.detachedFromTarget',
      sessionId: 'root-1',
      params: { sessionId: 'page-3' },
    })
    if (state === 'evicted') {
      for (let index = 0; index < 4; index++) {
        const params = { sessionId: `temporary-${index}` }
        browser.emit({ method: 'Target.attachedToTarget', sessionId: 'root-1', params })
        browser.emit({ method: 'Target.detachedFromTarget', sessionId: 'root-1', params })
      }
    } else if (state === 'reused') {
      browser.emit({
        method: 'Target.attachedToTarget',
        sessionId: 'root-1',
        params: { sessionId: 'page-3' },
      })
    }
    for (const message of waiting) browser.emit({ id: message.id, result: {} })
    await Promise.all([...active, queued])
    expect(messagesA.find((message) => message.id === 100)).toEqual({
      id: 100,
      sessionId: 'page-3',
      error: { code: -32001, message: 'Session with given id not found.' },
    })
    expect(
      browser.commands.filter((message) => message.method === 'Runtime.evaluate'),
    ).toHaveLength(0)
    expect(terminateA).not.toHaveBeenCalled()
  },
)

it('rejects a duplicate detach for an owned session without ever forwarding it twice', async () => {
  const { a, browser, messagesA, terminateA } = await fixture()
  await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
  await a.receive(encode('Target.detachFromTarget', { sessionId: 'page-3' }, undefined, 2))
  await a.receive(encode('Target.detachFromTarget', { sessionId: 'page-3' }, undefined, 3))
  expect(messagesA.at(-1)).toEqual({
    id: 3,
    sessionId: undefined,
    error: { code: -32602, message: 'No session with given id' },
  })
  expect(
    browser.commands.filter((message) => message.method === 'Target.detachFromTarget'),
  ).toHaveLength(1)
  expect(terminateA).not.toHaveBeenCalled()
})

it.each(['address', 'parameter'])(
  "never treats a peer's retired session as previously owned (%s)",
  async (kind) => {
    const { a, b, browser, terminateA, terminateB } = await fixture()
    await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
    browser.emit({
      method: 'Target.detachedFromTarget',
      sessionId: 'root-1',
      params: { sessionId: 'page-3' },
    })
    await b.receive(
      kind === 'address'
        ? encode('Runtime.evaluate', {}, 'page-3')
        : encode('Target.detachFromTarget', { sessionId: 'page-3' }),
    )
    expect(terminateA).not.toHaveBeenCalled()
    expect(terminateB).toHaveBeenCalledOnce()
    expect(browser.commands.some((message) => message.method === 'Runtime.evaluate')).toBe(false)
    expect(
      browser.commands.some(
        (message) =>
          message.method === 'Target.detachFromTarget' && message.params?.sessionId === 'page-3',
      ),
    ).toBe(false)
  },
)

it('does not let a known retired address hide a peer session in detach parameters', async () => {
  const { a, browser, terminateA } = await fixture()
  await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
  browser.emit({
    method: 'Target.detachedFromTarget',
    sessionId: 'root-1',
    params: { sessionId: 'page-3' },
  })
  await a.receive(encode('Target.detachFromTarget', { sessionId: 'root-2' }, 'page-3', 2))
  expect(terminateA).toHaveBeenCalledOnce()
  expect(
    browser.commands.some(
      (message) =>
        message.method === 'Target.detachFromTarget' && message.params?.sessionId === 'root-2',
    ),
  ).toBe(false)
})

it('bounds retired ownership and conservatively rejects identifiers no longer remembered', async () => {
  const { a, browser, messagesA, terminateA } = await fixture(3)
  for (let index = 0; index < 4; index++) {
    await a.receive(
      encode(
        'Target.attachToTarget',
        { targetId: `page-${index}`, flatten: true },
        undefined,
        index,
      ),
    )
    browser.emit({
      method: 'Target.detachedFromTarget',
      sessionId: 'root-1',
      params: { sessionId: `page-${index + 3}` },
    })
  }
  await a.receive(encode('Runtime.evaluate', {}, 'page-6', 5))
  expect(messagesA.at(-1)?.error?.code).toBe(-32001)
  expect(terminateA).not.toHaveBeenCalled()
  await a.receive(encode('Runtime.evaluate', {}, 'page-3', 6))
  expect(terminateA).toHaveBeenCalledOnce()
  expect(browser.commands.some((message) => message.method === 'Runtime.evaluate')).toBe(false)
})

it('retired session handling cannot bypass the duplicate in-flight request limit', async () => {
  const { a, browser, terminateA } = await fixture()
  await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
  browser.emit({
    method: 'Target.detachedFromTarget',
    sessionId: 'root-1',
    params: { sessionId: 'page-3' },
  })
  browser.handle((message) => message.method === 'Browser.getVersion')
  const running = a.receive(encode('Browser.getVersion', {}, undefined, 2))
  await a.receive(encode('Runtime.evaluate', {}, 'page-3', 2))
  await running
  expect(terminateA).toHaveBeenCalledOnce()
  expect(browser.commands.some((message) => message.method === 'Runtime.evaluate')).toBe(false)
})

it('does not revive a detached session when its earlier attach response resumes on a microtask', async () => {
  const { a, browser, messagesA, terminateA } = await fixture()
  browser.handle((message) => {
    if (message.method !== 'Target.attachToTarget') return false
    const params = { sessionId: 'late-attachment' }
    browser.emit({ method: 'Target.attachedToTarget', sessionId: 'root-1', params })
    browser.emit({ id: message.id, result: params })
    browser.emit({ method: 'Target.detachedFromTarget', sessionId: 'root-1', params })
    return true
  })
  await a.receive(encode('Target.attachToTarget', { targetId: 'page', flatten: true }))
  await a.receive(encode('Runtime.evaluate', {}, 'late-attachment', 2))
  expect(messagesA.at(-1)?.error?.code).toBe(-32001)
  expect(terminateA).not.toHaveBeenCalled()
  expect(browser.commands.some((message) => message.method === 'Runtime.evaluate')).toBe(false)
})
