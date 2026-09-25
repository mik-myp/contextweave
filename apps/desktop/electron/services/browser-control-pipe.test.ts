import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlLimits, createControlPipe, type ControlMessage } from './browser-control-pipe'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0).reverse()) clean()
  vi.useRealTimers()
})
function fixture(limits: Partial<{ [K in keyof typeof controlLimits]: number }> = {}) {
  const input = new PassThrough(),
    output = new PassThrough()
  const commands: ControlMessage[] = []
  input.on('data', (chunk: Buffer) => {
    for (const text of chunk.toString('utf8').split('\0').filter(Boolean))
      commands.push(JSON.parse(text))
  })
  const pipe = createControlPipe(input, output, { ...controlLimits, ...limits })
  cleanups.push(pipe.close)
  const reply = (value: unknown) => output.write(Buffer.from(`${JSON.stringify(value)}\0`))
  return { input, output, commands, pipe, reply }
}

describe('private Chromium pipe', () => {
  it('frames UTF-8 across chunks and matches rewritten IDs instead of response order', async () => {
    const { pipe, commands, output, reply } = fixture()
    const events: ControlMessage[] = []
    pipe.onEvent((value) => events.push(value))
    const a = pipe.send('Browser.getVersion'),
      b = pipe.send('Target.getTargets', {}, 'root-a')
    expect(commands.map((v) => v.id)).toEqual([1, 2])
    expect(commands[1].sessionId).toBe('root-a')
    reply({ id: 2, result: { targetInfos: [] } })
    const bytes = Buffer.from(`${JSON.stringify({ id: 1, result: { product: '浏览器' } })}\0`)
    const split = bytes.indexOf(Buffer.from('浏')) + 1
    output.write(bytes.subarray(0, split))
    output.write(bytes.subarray(split))
    output.write(
      Buffer.from(
        '{"method":"Target.targetCreated","params":{}}\0{"method":"Target.targetDestroyed","params":{}}\0',
      ),
    )
    await expect(a).resolves.toEqual({ result: { product: '浏览器' } })
    await expect(b).resolves.toEqual({ result: { targetInfos: [] } })
    expect(events).toHaveLength(2)
  })
  it.each([
    Buffer.from('{invalid}\0'),
    Buffer.from([0xff, 0]),
    Buffer.from('{"id":1}\0'),
    Buffer.from('{"id":1,"method":"Unexpected","result":{}}\0'),
    Buffer.from('x'.repeat(129)),
  ])('fails closed on malformed/oversized browser output', async (payload) => {
    const { pipe, output } = fixture({ frameBytes: 128 })
    const closed = vi.fn()
    pipe.onClose(closed)
    const pending = pipe.send('Browser.getVersion')
    const rejected = expect(pending).rejects.toThrow('CONTROL_PROTOCOL')
    output.write(payload)
    await rejected
    expect(pipe.closed).toBe(true)
    pipe.close()
    expect(closed).toHaveBeenCalledTimes(1)
    await expect(pipe.send('Browser.getVersion')).rejects.toThrow('CONTROL_CLOSED')
  })
  it('caps each frame rather than dropping a valid coalesced sequence', async () => {
    const { pipe, output } = fixture({ frameBytes: 32 })
    const first = pipe.send('Browser.getVersion'),
      second = pipe.send('Browser.getVersion')
    output.write(Buffer.from('{"id":1,"result":{}}\0{"id":2,"result":{}}\0'))
    await expect(first).resolves.toEqual({ result: {} })
    await expect(second).resolves.toEqual({ result: {} })
    expect(pipe.closed).toBe(false)
  })
  it('rejects oversized commands and caps outstanding work without closing healthy peers', async () => {
    const { pipe, reply } = fixture({ commandBytes: 128, pendingCommands: 1 })
    await expect(pipe.send('Page.navigate', { url: 'x'.repeat(130) })).rejects.toThrow(
      'CONTROL_COMMAND_LIMIT',
    )
    const first = pipe.send('Browser.getVersion')
    await expect(pipe.send('Browser.getVersion')).rejects.toThrow('CONTROL_COMMAND_LIMIT')
    reply({ id: 2, result: {} })
    await first
    expect(pipe.closed).toBe(false)
  })
  it('bounds a blocked writable queue and rejects all work when the stream breaks', async () => {
    const input = new Writable({
      write() {
        /* Intentionally retain the write callback. */
      },
    })
    const output = new PassThrough()
    const pipe = createControlPipe(input, output, { ...controlLimits, queuedBytes: 100 })
    cleanups.push(pipe.close)
    const first = pipe.send('Browser.getVersion')
    const rejected = expect(first).rejects.toThrow('CONTROL_CLOSED')
    await expect(pipe.send('Browser.getVersion')).rejects.toThrow('CONTROL_COMMAND_LIMIT')
    input.emit('error', new Error('private low-level failure'))
    await rejected
  })
  it('cancels one pending request without disconnecting other clients or leaking its late response', async () => {
    const { pipe, reply } = fixture()
    const controller = new AbortController()
    const pending = pipe.send('Browser.getVersion', {}, undefined, { signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('CONTROL_CANCELLED')
    controller.abort()
    await rejected
    reply({ id: 1, result: { product: 'late' } })
    const next = pipe.send('Browser.getVersion')
    reply({ id: 2, result: { product: 'live' } })
    await expect(next).resolves.toEqual({ result: { product: 'live' } })
    expect(pipe.closed).toBe(false)
  })
  it('enforces deadlines and clears timers on EOF, including an incomplete frame', async () => {
    vi.useFakeTimers()
    const { pipe } = fixture()
    const pending = pipe.send('Browser.getVersion', {}, undefined, { timeoutMs: 10 })
    const rejected = expect(pending).rejects.toThrow('CONTROL_TIMEOUT')
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    const next = fixture()
    const another = next.pipe.send('Browser.getVersion')
    const ended = expect(another).rejects.toThrow('CONTROL_CLOSED')
    next.output.write('{"id":')
    next.output.end()
    await ended
    expect(vi.getTimerCount()).toBe(0)
  })
})
