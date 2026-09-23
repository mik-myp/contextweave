export type BatchFailure = { id: string; label: string; message: string }

/** Sequential mutations avoid launch storms; partial success remains visible and retryable. */
export async function runBatch<T>({
  items,
  getId,
  getLabel,
  action,
  onProgress,
}: {
  items: readonly T[]
  getId: (item: T) => string
  getLabel: (item: T) => string
  action: (item: T) => Promise<unknown>
  onProgress?: (completed: number) => void
}) {
  const succeeded: string[] = []
  const failures: BatchFailure[] = []
  for (const item of items) {
    try {
      await action(item)
      succeeded.push(getId(item))
    } catch (cause) {
      failures.push({
        id: getId(item),
        label: getLabel(item),
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
    onProgress?.(succeeded.length + failures.length)
  }
  return { succeeded, failures }
}
