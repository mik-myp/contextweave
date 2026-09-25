import { describe, expect, it } from 'vitest'
import { workerEventSchema, workerResultSchema, workerTaskSchema, workerProcessRequestSchema, workerProcessResultSchema } from './index'

describe('worker protocol', () => {
  it('applies the browser smoke timeout default', () => {
    const task = workerTaskSchema.parse({
      protocolVersion: 1,
      taskId: 'task-test',
      environmentId: 'env-test',
      kind: 'browser-smoke',
      input: { url: 'https://example.com' },
    })

    expect(task.input.timeoutMs).toBe(30000)
  })

  it('rejects protocol version mismatches', () => {
    expect(workerTaskSchema.safeParse({
      protocolVersion: 2,
      taskId: 'task-test',
      environmentId: 'env-test',
      kind: 'browser-smoke',
      input: { url: 'https://example.com' },
    }).success).toBe(false)
  })

  it('validates event and result envelopes', () => {
    expect(workerEventSchema.parse({
      protocolVersion: 1,
      taskId: 'task-test',
      environmentId: 'env-test',
      step: 'open-page',
      status: 'completed',
      at: '2026-09-21T00:00:00.000Z',
    }).status).toBe('completed')
    expect(workerResultSchema.parse({
      protocolVersion: 1,
      taskId: 'task-test',
      environmentId: 'env-test',
      ok: true,
      title: 'Example Domain',
    }).title).toBe('Example Domain')
  })
})

describe('worker request filesystem boundary', () => {
  const task = {
    protocolVersion: 1,
    taskId: 'task-safe_123',
    environmentId: 'env-test',
    kind: 'browser-smoke',
    input: { url: 'https://example.com' },
  }

  it.each(['../outside', '..\\outside', '/absolute', 'C:\\outside', 'a/b', 'a\\b', '.', '..', 'a\u0000b', 'a:b', 'a'.repeat(129)])(
    'rejects unsafe or unbounded task IDs: %j',
    (taskId) => expect(workerTaskSchema.safeParse({ ...task, taskId }).success).toBe(false),
  )

  it.each(['../outside.png', '/tmp/outside.png', 'C:\\outside.png', ''])('rejects caller-supplied screenshot paths: %j', (screenshotPath) => {
    expect(workerTaskSchema.safeParse({ ...task, input: { ...task.input, screenshotPath } }).success).toBe(false)
  })

  it('rejects caller-supplied output directories and unsupported URL protocols', () => {
    expect(workerTaskSchema.safeParse({ ...task, outputDirectory: '/tmp' }).success).toBe(false)
    expect(workerTaskSchema.safeParse({ ...task, input: { url: 'file:///tmp/private' } }).success).toBe(false)
    expect(workerTaskSchema.safeParse(task).success).toBe(true)
  })
})


describe('private Main / Worker envelopes', () => {
  const task = {
    protocolVersion: 1,
    taskId: 'task-safe',
    environmentId: 'env-test',
    kind: 'browser-smoke',
    input: { url: 'http://127.0.0.1/' },
  }

  it('accepts only a valid local control port, not caller-supplied connection URLs', () => {
    expect(workerProcessRequestSchema.safeParse({ task, controlPort: 9222 }).success).toBe(true)
    for (const controlPort of [0, -1, 65536, 1.5, '9222']) {
      expect(workerProcessRequestSchema.safeParse({ task, controlPort }).success).toBe(false)
    }
    expect(workerProcessRequestSchema.safeParse({ task, controlPort: 9222, controlUrl: 'http://other/' }).success).toBe(false)
  })

  it('also rejects task traversal and output paths inside the worker process', () => {
    expect(workerProcessRequestSchema.safeParse({ task: { ...task, taskId: '../outside' }, controlPort: 9222 }).success).toBe(false)
    expect(workerProcessRequestSchema.safeParse({ task, controlPort: 9222, outputDirectory: '/outside' }).success).toBe(false)
    expect(workerProcessRequestSchema.safeParse({ task: { ...task, input: { ...task.input, screenshotPath: '/outside' } }, controlPort: 9222 }).success).toBe(false)
  })

  it('allows only Main to attach a screenshot path to the public result', () => {
    const result = { protocolVersion: 1, taskId: 'task-safe', environmentId: 'env-test', ok: true }
    expect(workerProcessResultSchema.safeParse(result).success).toBe(true)
    expect(workerProcessResultSchema.safeParse({ ...result, screenshotPath: '/outside' }).success).toBe(false)
    expect(workerResultSchema.safeParse({ ...result, screenshotPath: '/main-owned/screenshot.png' }).success).toBe(true)
  })
})

it('rejects unbounded navigation, credential-bearing URLs, and unused private secrets', () => {
  const task = {
    protocolVersion: 1,
    taskId: 'task-safe',
    environmentId: 'env-test',
    kind: 'browser-smoke',
    input: { url: 'https://example.invalid/' },
  }
  for (const url of [
    'https://u:secret@example.invalid/',
    'https://example.invalid/' + 'x'.repeat(8192),
    'not a URL',
  ])
    expect(workerTaskSchema.safeParse({ ...task, input: { url } }).success).toBe(false)
  expect(workerTaskSchema.safeParse({ ...task, environmentId: 'e'.repeat(201) }).success).toBe(
    false,
  )
  expect(workerTaskSchema.safeParse({ ...task, controlPort: 9222 }).success).toBe(false)
  expect(
    workerProcessRequestSchema.safeParse({
      task,
      controlPort: 9222,
      proxyCredentials: { username: 'u', password: 'secret' },
    }).success,
  ).toBe(false)
})
