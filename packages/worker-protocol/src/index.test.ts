import { describe, expect, it } from 'vitest'
import { workerEventSchema, workerResultSchema, workerTaskSchema } from './index'

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
