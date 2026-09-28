import { z } from 'zod'
import { bookmarkSchema, maxDefaultBookmarks } from '@contextweave/contracts'

/** Main-only CDP operation. URLs never enter process arguments or diagnostic logs. */
export async function openStartupBookmarkTargets(
  input: unknown,
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  signal: AbortSignal,
) {
  const urls = [
    ...new Set(
      z
        .array(bookmarkSchema.shape.url)
        .max(maxDefaultBookmarks)
        .parse(input)
        .map((url) => new URL(url).href),
    ),
  ]
  signal.throwIfAborted()
  if (!urls.length) return
  const targets = z
    .object({ targetInfos: z.array(z.object({ type: z.string(), url: z.string() })) })
    .parse(await send('Target.getTargets', {}))
  const existing = new Set(
    targets.targetInfos
      .filter((target) => target.type === 'page')
      .flatMap((target) => {
        try {
          return [new URL(target.url).href]
        } catch {
          return []
        }
      }),
  )
  for (const url of urls) {
    signal.throwIfAborted()
    if (existing.has(url)) continue
    z.object({ targetId: z.string().min(1) }).parse(await send('Target.createTarget', { url }))
    existing.add(url)
  }
  signal.throwIfAborted()
}
