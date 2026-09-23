import { useRef, useState } from 'react'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { runBatch, type BatchFailure } from '@/shared/lib/batch'

export function useBatchMutation() {
  const { refresh, setNotice } = useAppData()
  const { t } = useI18n()
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [failures, setFailures] = useState<BatchFailure[]>([])
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  async function run<T>(options: Omit<Parameters<typeof runBatch<T>>[0], 'onProgress'>) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setFailures([])
    setProgress({ completed: 0, total: options.items.length })
    try {
      const result = await runBatch({
        ...options,
        onProgress: (completed) => setProgress({ completed, total: options.items.length }),
      })
      setFailures(result.failures)
      await refresh()
      setNotice({
        kind: result.failures.length ? 'error' : 'success',
        message: t('admin.batchResult')
          .replace('{success}', String(result.succeeded.length))
          .replace('{failed}', String(result.failures.length)),
      })
      return result
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return { run, pending, failures, progress }
}
