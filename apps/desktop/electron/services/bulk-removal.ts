import type { BulkDeleteResult, IpcResult } from '@contextweave/contracts'
import { isSqliteFailure } from '@contextweave/storage'

/** Narrow, validated callers supply their existing owner/revision-checked deletion service. */
export async function removeItems<T>(
  items: T[],
  id: (item: T) => string,
  remove: (item: T) => Promise<IpcResult<boolean>> | IpcResult<boolean>,
): Promise<BulkDeleteResult> {
  const results: BulkDeleteResult = []
  for (const item of items) {
    try {
      const result = await remove(item)
      results.push(
        result.ok
          ? { id: id(item), ok: true }
          : {
              id: id(item),
              ok: false,
              code: /^[A-Z][A-Z_]+$/.test(result.code) ? result.code : 'COMMAND_FAILED',
            },
      )
    } catch (error) {
      const code = isSqliteFailure(error)
        ? 'COMMAND_STORAGE_FAILED'
        : error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message)
          ? error.message
          : 'COMMAND_FAILED'
      results.push({ id: id(item), ok: false, code })
    }
  }
  return results
}
