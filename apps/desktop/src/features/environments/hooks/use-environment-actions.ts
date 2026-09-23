import { useCallback, useRef, useState } from 'react'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { environmentService } from '../environment-service'

export function useEnvironmentActions() {
  const { refresh, setNotice, upsertEnvironment } = useAppData(['environments'])
  const { t } = useI18n()
  const active = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [stopTarget, setStopTarget] = useState<EnvironmentSummary>()
  const run = useCallback(
    async (environment: EnvironmentSummary, action: 'start' | 'stop') => {
      if (active.current.has(environment.id) && action !== 'stop') return
      active.current.add(environment.id)
      setPending(new Set(active.current))
      try {
        upsertEnvironment(await environmentService[action](environment.id))
        await refresh()
        setNotice({
          kind: 'success',
          message: t(action === 'start' ? 'env.started' : 'env.stopped'),
        })
        if (action === 'stop') setStopTarget(undefined)
      } catch (cause) {
        setNotice({
          kind: 'error',
          message: cause instanceof Error ? cause.message : t('env.operationError'),
        })
        setStopTarget(undefined)
        await refresh()
      } finally {
        active.current.delete(environment.id)
        setPending(new Set(active.current))
      }
    },
    [refresh, setNotice, upsertEnvironment, t],
  )
  const start = useCallback(
    (environment: EnvironmentSummary) => {
      void run(environment, 'start')
    },
    [run],
  )
  return {
    pending,
    stopTarget,
    setStopTarget,
    start,
    stop: () => {
      if (stopTarget) void run(stopTarget, 'stop')
    },
  }
}
