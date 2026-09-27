import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { environmentCommandRequestSchema } from '@contextweave/contracts'
import { normalizeEnvironmentCommand } from './command-intent'
const owner = { workspaceId: randomUUID() }
const create = () => ({
  requestId: randomUUID(),
  kind: 'create',
  input: { name: 'Example', kernelId: 'standard-chromium' },
})

describe('normalized environment command intent', () => {
  it('hashes normalized intent, not the request key, object ordering, omitted defaults or whitespace', () => {
    const first = create(),
      parsed = environmentCommandRequestSchema.parse(first)
    const normal = normalizeEnvironmentCommand(owner, first)
    expect(normal.intentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(
      normalizeEnvironmentCommand(owner, { ...parsed, requestId: randomUUID() }).intentDigest,
    ).toBe(normal.intentDigest)
    expect(
      normalizeEnvironmentCommand(owner, {
        ...first,
        input: { kernelId: 'standard-chromium ', name: ' Example ' },
      }).intentDigest,
    ).toBe(normal.intentDigest)
    const withConfig = {
      ...first,
      input: { ...first.input, kernelConfig: { b: { y: 1, x: 2 }, a: true } },
    }
    const reordered = {
      ...first,
      input: { ...first.input, kernelConfig: { a: true, b: { x: 2, y: 1 } } },
    }
    expect(normalizeEnvironmentCommand(owner, withConfig).intentDigest).toBe(
      normalizeEnvironmentCommand(owner, reordered).intentDigest,
    )
    expect(normal.request).toEqual(parsed)
  })
  it('changes the digest for owner, action, target, revision or configuration differences', () => {
    const request = {
      requestId: randomUUID(),
      kind: 'start',
      environmentId: 'env',
      expectedRevision: 1,
    }
    const original = normalizeEnvironmentCommand(owner, request).intentDigest
    for (const change of [{ kind: 'stop' }, { environmentId: 'other' }, { expectedRevision: 2 }])
      expect(normalizeEnvironmentCommand(owner, { ...request, ...change }).intentDigest).not.toBe(
        original,
      )
    expect(
      normalizeEnvironmentCommand({ workspaceId: randomUUID() }, request).intentDigest,
    ).not.toBe(original)
    const first = create()
    expect(normalizeEnvironmentCommand(owner, first).intentDigest).not.toBe(
      normalizeEnvironmentCommand(owner, { ...first, input: { ...first.input, name: 'Different' } })
        .intentDigest,
    )
  })
  it('requires all seven explicit kinds, IDs and revisions, with no inline proxy credentials', () => {
    for (const kind of ['start', 'stop', 'trash', 'restore', 'recover']) {
      const request = { requestId: randomUUID(), kind, environmentId: 'env', expectedRevision: 1 }
      expect(() => normalizeEnvironmentCommand(owner, request)).not.toThrow()
      expect(() =>
        normalizeEnvironmentCommand(owner, { ...request, expectedRevision: undefined }),
      ).toThrow()
    }
    const request = create()
    expect(() =>
      normalizeEnvironmentCommand(owner, {
        ...request,
        input: { ...request.input, proxy: { password: 'must-not-hash' } },
      }),
    ).toThrow()
    expect(() => normalizeEnvironmentCommand(owner, { ...request, requestId: undefined })).toThrow()
    const update = {
      requestId: randomUUID(),
      kind: 'update',
      input: {
        environmentId: 'env',
        expectedRevision: 2,
        version: 1,
        name: 'name',
        proxyId: null,
        browserSettings: {
          language: 'en-US',
          timezone: 'UTC',
          window: { width: 1000, height: 800 },
        },
      },
    }
    expect(() => normalizeEnvironmentCommand(owner, update)).not.toThrow()
    expect(() =>
      normalizeEnvironmentCommand(owner, {
        ...update,
        input: { ...update.input, expectedRevision: undefined },
      }),
    ).toThrow()
  })
  it.each([
    NaN,
    Infinity,
    1n,
    new Date(),
    () => undefined,
    Symbol('no'),
    [undefined],
    new Array(1),
  ])('rejects non-JSON values without implicit lossy coercion: %s', (value) => {
    const request = create()
    expect(() =>
      normalizeEnvironmentCommand(owner, {
        ...request,
        input: { ...request.input, kernelConfig: { value } },
      }),
    ).toThrow('CONFIG_INVALID')
  })
  it('rejects cycles, accessors, deep and excessive work before parsing/copying the configuration', () => {
    const request = create(),
      input: Record<string, unknown> = {}
    input.self = input
    const submit = (kernelConfig: Record<string, unknown>) =>
      normalizeEnvironmentCommand(owner, { ...request, input: { ...request.input, kernelConfig } })
    expect(() => submit(input)).toThrow('CONFIG_INVALID')
    let accessed = false
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        accessed = true
        return 'secret'
      },
    })
    expect(() => submit(accessor)).toThrow('CONFIG_INVALID')
    expect(accessed).toBe(false)
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 40; i++) deep = { next: deep }
    expect(() => submit(deep)).toThrow('CONFIG_INVALID')
    expect(() => submit({ tooLong: 'a'.repeat(65537) })).toThrow('CONFIG_INVALID')
    expect(() =>
      submit({ manyBytes: Array.from({ length: 10 }, () => 'a'.repeat(40000)) }),
    ).toThrow('CONFIG_INVALID')
    expect(() => submit({ manyValues: Array(20001).fill(0) })).toThrow('CONFIG_INVALID')
  })
})
