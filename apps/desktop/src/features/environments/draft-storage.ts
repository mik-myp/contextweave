import { workspaceContextSchema, type WorkspaceContext } from '@contextweave/contracts'
import { z } from 'zod'
import type { EnvironmentDraft } from './environment-draft-context'
const legacyKey = 'contextweave:environment-drafts:v1'
const claimKey = 'contextweave:environment-drafts:v1-owner'
export const draftKey = (context: WorkspaceContext) =>
  `contextweave:environment-drafts:v2:${workspaceContextSchema.parse(context).workspaceId}`
// A cleared number input is NaN in RHF and null in JSON. Keep that incomplete
// draft; normal form validation still rejects it at submission, not at each keystroke.
const draftNumber = z
  .preprocess(
    (value) => (typeof value === 'number' && !Number.isFinite(value) ? null : value),
    z.number().finite().nullable(),
  )
  .transform((value) => value ?? NaN)
const fields = z
  .object({
    name: z.string().max(200),
    kernelId: z.string(),
    connection: z.enum(['direct', 'proxy']),
    proxyId: z.string(),
    language: z.string(),
    timezone: z.string(),
    width: draftNumber,
    height: draftNumber,
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
const envelope = workspaceContextSchema.extend({ version: z.literal(2), entries: stored })
const claim = workspaceContextSchema.extend({ entries: stored })
/** Ownerless drafts can be claimed only by the verified original default workspace. */
export function createDraftStore(
  context: WorkspaceContext,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
  legacyDraftOwner?: string,
): Map<string, EnvironmentDraft> {
  const owner = workspaceContextSchema.parse(context)
  const key = draftKey(owner)
  let entries: [string, EnvironmentDraft][] = []
  try {
    const raw = storage?.getItem(key)
    if (raw !== null && raw !== undefined) {
      const value = envelope.parse(JSON.parse(raw))
      if (value.workspaceId === owner.workspaceId) entries = value.entries
    } else {
      const claimed = storage?.getItem(claimKey)
      if (claimed) {
        const value = claim.parse(JSON.parse(claimed))
        if (value.workspaceId === owner.workspaceId) entries = value.entries
      } else if (legacyDraftOwner === owner.workspaceId) {
        entries = stored.parse(JSON.parse(storage?.getItem(legacyKey) ?? '[]'))
        // Claim before copying, so a later space cannot claim after a partial write.
        storage?.setItem(claimKey, JSON.stringify({ ...owner, entries }))
      }
    }
  } catch {
    // Damaged/full/denied storage must not prevent non-secret in-memory editing.
  }
  const drafts = new Map(entries)
  const persist = () => {
    try {
      storage?.setItem(key, JSON.stringify({ version: 2, ...owner, entries: [...drafts] }))
    } catch {
      /* Keep current edits in memory when browser storage is unavailable. */
    }
  }
  drafts.set = (id, value) => {
    const [entry] = stored.parse([[id, value]])
    Map.prototype.set.call(drafts, entry![0], entry![1])
    while (drafts.size > 30) Map.prototype.delete.call(drafts, drafts.keys().next().value)
    persist()
    return drafts
  }
  drafts.delete = (id) => {
    const removed = Map.prototype.delete.call(drafts, id)
    persist()
    return removed
  }
  drafts.clear = () => {
    Map.prototype.clear.call(drafts)
    persist()
  }
  return drafts
}
