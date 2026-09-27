import { useActiveCommands, useCommandTracking } from '../commands/use-commands'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { useEnvironmentService } from '../environment-service'

export function useEnvironmentActions() {
  const environmentService = useEnvironmentService()
  const activity = useActiveCommands(),
    tracking = useCommandTracking()

  const { refresh, setNotice, upsertEnvironment, environments } = useAppData(['environments'])
  const { t } = useI18n()
  const active = useRef(new Set<string>())
  const [localPending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [stopTarget, setStopTarget] = useState<EnvironmentSummary>()
  const run = useCallback(
    async (environment: EnvironmentSummary, action: 'start' | 'stop') => {
      if (active.current.has(environment.id) && action !== 'stop') return
      active.current.add(environment.id)
      setPending(new Set(active.current))
      try {
        upsertEnvironment(await environmentService[action](environment.id, environment.revision))
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
    [refresh, setNotice, upsertEnvironment, t, environmentService],
  )
  const start = useCallback(
    (environment: EnvironmentSummary) => {
      void run(environment, 'start')
    },
    [run],
  )
  const pending = useMemo(
    () =>
      new Set([
        ...localPending,
        ...(activity.data?.items.map((item) => item.environmentId) ?? []),
        ...tracking.entries.flatMap((entry) => (entry.environmentId ? [entry.environmentId] : [])),
        ...(tracking.problem ? environments.map((item) => item.id) : []),
      ]),
    [localPending, activity.data, tracking.entries, tracking.problem, environments],
  )
  const queued = useMemo(
    () =>
      new Set(
        activity.data?.items
          .filter((item) => item.status === 'queued')
          .map((item) => item.environmentId),
      ),
    [activity.data],
  )
  return {
    pending,
    queued,
    commandError: activity.error?.message,
    stopTarget,
    setStopTarget,
    start,
    stop: () => {
      if (stopTarget) void run(stopTarget, 'stop')
    },
  }
}
