import { randomUUID } from 'node:crypto'
import {
  historyCleanupRequestSchema,
  historyCleanupConfirmSchema,
  historyCleanupPreviewSchema,
  type DataDomain,
  type HistoryCleanupPreview,
  type HistoryCleanupResult,
} from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'

export const historyCleanupPreviewTtlMs = 5 * 60_000
export function createHistoryCleanupService(
  repository: EnvironmentRepository,
  changed: (domains: DataDomain[]) => void,
  clock = { now: () => Date.now(), monotonic: () => performance.now() },
) {
  // One Main-owned batch. Re-preview replaces it; there is no automatic continuation or timer.
  let pending:
    | {
        preview: HistoryCleanupPreview
        candidates: ReturnType<EnvironmentRepository['previewHistoryCleanup']>
        deadline: number
      }
    | undefined
  return {
    preview(input: unknown): HistoryCleanupPreview {
      const { retentionDays } = historyCleanupRequestSchema.parse(input)
      // Invalidate even if querying a replacement fails: the old confirmation is no longer current.
      pending = undefined
      repository.getHistoryCleanupReceipt()
      const now = clock.now()
      const deadline = clock.monotonic() + historyCleanupPreviewTtlMs
      const cutoffAt = new Date(now - retentionDays * 86_400_000).toISOString()
      const candidates = repository.previewHistoryCleanup(cutoffAt)
      const createdAt = new Date(now).toISOString()
      const preview = historyCleanupPreviewSchema.parse({
        previewId: randomUUID(),
        retentionDays,
        cutoffAt,
        createdAt,
        expiresAt: new Date(now + historyCleanupPreviewTtlMs).toISOString(),
        sessions: { count: candidates.sessions.length, hasMore: candidates.moreSessions },
        operations: { count: candidates.operations.length, hasMore: candidates.moreOperations },
      })
      pending = { preview, candidates, deadline }
      return preview
    },
    confirm(input: unknown): HistoryCleanupResult {
      const { previewId } = historyCleanupConfirmSchema.parse(input)
      const previous = repository.getHistoryCleanupReceipt()
      if (previous?.previewId === previewId) {
        changed(['activity', 'operations', 'storage'])
        return { receipt: previous, replayed: true }
      }
      if (!pending || previewId !== pending.preview.previewId)
        throw new Error('HISTORY_CLEANUP_PREVIEW_INVALID')
      if (
        clock.monotonic() >= pending.deadline ||
        clock.now() >= Date.parse(pending.preview.expiresAt)
      ) {
        pending = undefined
        throw new Error('HISTORY_CLEANUP_PREVIEW_EXPIRED')
      }
      if (!pending.candidates.sessions.length && !pending.candidates.operations.length)
        throw new Error('HISTORY_CLEANUP_EMPTY')
      const result = repository.commitHistoryCleanup(
        pending.preview,
        pending.candidates,
        new Date(clock.now()).toISOString(),
      )
      pending = undefined
      // If delivery fails, a retry/receipt lookup still identifies this committed batch.
      changed(['activity', 'operations', 'storage'])
      return result
    },
    receipt: () => repository.getHistoryCleanupReceipt(),
  }
}
