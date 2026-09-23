import { z } from 'zod'
import type { EnvironmentDraft } from './environment-draft-context'
const key = 'contextweave:environment-drafts:v1'
const fields = z
  .object({
    name: z.string().max(200),
    kernelId: z.string(),
    connection: z.enum(['direct', 'proxy']),
    proxyId: z.string(),
    language: z.string(),
    timezone: z.string(),
    width: z.number().finite(),
    height: z.number().finite(),
  })
  .strict()
const stored = z
  .array(
    z.tuple([
      z.string(),
      z
        .object({
          values: fields,
          defaults: fields,
          revision: z.number().int().positive().optional(),
        })
        .strict(),
    ]),
  )
  .max(30)
/** Only non-secret form fields are allowed; credentials and kernel-private data cannot enter drafts. */
export function createDraftStore(
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): Map<string, EnvironmentDraft> {
  let entries: [string, EnvironmentDraft][] = []
  try {
    entries = stored.parse(JSON.parse(storage?.getItem(key) ?? '[]'))
  } catch {
    /* A damaged draft does not prevent opening the editor. */
  }
  const drafts = new Map(entries)
  const persist = () => {
    try {
      storage?.setItem(key, JSON.stringify([...drafts].slice(-30)))
    } catch {
      /* In-memory editing remains available when browser storage is full. */
    }
  }
  drafts.set = (id, value) => {
    Map.prototype.set.call(drafts, id, value)
    persist()
    return drafts
  }
  drafts.delete = (id) => {
    const removed = Map.prototype.delete.call(drafts, id)
    persist()
    return removed
  }
  return drafts
}
