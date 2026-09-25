import { useRef, useState } from 'react'
import type { KernelSummary } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { useAppData } from '@/app/use-app-data'
import { unwrapIpc } from '@/shared/lib/ipc'

export function useKernelRemoval() {
  const { t } = useI18n()
  const { refresh, setNotice } = useAppData(['kernels'])
  const [selected, setSelected] = useState<KernelSummary>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const busy = useRef(false)
  const select = (kernel?: KernelSummary) => {
    if (busy.current) return
    setError(undefined)
    setSelected(kernel)
  }
  const confirm = async () => {
    if (!selected || busy.current) return
    busy.current = true
    setPending(true)
    setError(undefined)
    try {
      await unwrapIpc(window.contextweave.kernel.remove(selected.id))
      setSelected(undefined)
      setNotice({ kind: 'success', message: t('kernel.removed') })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.operationError'))
      await refresh()
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return { selected, select, pending, error, confirm }
}
