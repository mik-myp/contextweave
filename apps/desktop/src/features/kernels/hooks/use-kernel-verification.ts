import { useEffect, useRef, useState } from 'react'
import { useAppData } from '@/app/use-app-data'
import { useWorkspaceApi } from '@/features/workspaces/workspace-session-context'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { toast } from '@/components/ui/toast'

export function useKernelVerification() {
  const api = useWorkspaceApi(),
    { refresh } = useAppData(['kernels']),
    { t } = useI18n()
  const [checking, setChecking] = useState(false)
  const busy = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const verify = async (id: string) => {
    if (busy.current) return
    busy.current = true
    setChecking(true)
    try {
      const result = await unwrapIpc(api.kernel.verify(id))
      await refresh()
      const failed =
        result.verification?.state === 'failed' ||
        Object.values(result.capabilityReport).some((item) => item.state === 'failed')
      toast.add({
        title: t(failed ? 'kernel.probeFailed' : 'kernel.probeComplete'),
        type: failed ? 'error' : 'success',
      })
    } catch (cause) {
      toast.add({
        title: cause instanceof Error ? cause.message : t('admin.operationError'),
        type: 'error',
      })
    } finally {
      busy.current = false
      if (mounted.current) setChecking(false)
    }
  }
  return { checking, verify }
}
