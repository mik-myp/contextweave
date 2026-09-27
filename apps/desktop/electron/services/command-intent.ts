import { createHash } from 'node:crypto'
import {
  environmentCommandRequestSchema,
  workspaceContextSchema,
  type WorkspaceContext,
} from '@contextweave/contracts'

/** Bounded JSON only: hash normalized schema output, never persist the input body. */
function canonicalJson(input: unknown): string {
  const ancestors = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (value: unknown, depth: number): string => {
    bytes += 2
    if (++nodes > 20000 || depth > 32 || bytes > 262144) throw new Error('CONFIG_INVALID')
    if (value === null || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'string') {
      if (value.length > 65536) throw new Error('CONFIG_INVALID')
      const encoded = JSON.stringify(value)
      bytes += Buffer.byteLength(encoded, 'utf8')
      if (bytes > 262144) throw new Error('CONFIG_INVALID')
      return encoded
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (typeof value !== 'object' || value === null || ancestors.has(value))
      throw new Error('CONFIG_INVALID')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (value.length > 20000) throw new Error('CONFIG_INVALID')
        // Do not invoke custom iterators/accessors; holes must not alias JSON null.
        const items: string[] = []
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
          if (!descriptor || !('value' in descriptor)) throw new Error('CONFIG_INVALID')
          items.push(visit(descriptor.value, depth + 1))
        }
        return `[${items.join(',')}]`
      }
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new Error('CONFIG_INVALID')
      const keys = Object.keys(value)
      if (keys.length > 20000 || Object.getOwnPropertySymbols(value).length)
        throw new Error('CONFIG_INVALID')
      const entries = keys.sort().flatMap((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !('value' in descriptor)) throw new Error('CONFIG_INVALID')
        if (descriptor.value === undefined) return []
        return [`${visit(key, depth + 1)}:${visit(descriptor.value, depth + 1)}`]
      })
      return `{${entries.join(',')}}`
    } finally {
      ancestors.delete(value)
    }
  }
  const result = visit(input, 0)
  if (Buffer.byteLength(result, 'utf8') > 262144) throw new Error('CONFIG_INVALID')
  return result
}

export function normalizeEnvironmentCommand(context: WorkspaceContext, input: unknown) {
  const owner = workspaceContextSchema.parse(context)
  // Inspect bounds before recursive schema copying; do not JSON-coerce Dates, NaN or BigInts.
  canonicalJson(input)
  const request = environmentCommandRequestSchema.parse(input)
  const intent = { ...request, requestId: undefined }
  const intentDigest = createHash('sha256')
    .update('ContextWeave/environment-command/v1\0')
    .update(canonicalJson({ ...owner, ...intent }))
    .digest('hex')
  return { request: structuredClone(request), intentDigest }
}
