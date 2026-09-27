import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { EnvironmentDetails } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { environmentService } from '../environment-service'
import { EnvironmentEditor } from '../components/environment-editor'

export function EnvironmentConfigPage({ environmentId }: { environmentId?: string }) {
  return <EnvironmentConfigContent key={environmentId ?? 'new'} environmentId={environmentId} />
}

function EnvironmentConfigContent({ environmentId }: { environmentId?: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>('[data-scroll-restoration]')
    if (scroller) scroller.scrollTop = 0
  }, [environmentId])
  const [loaded, setLoaded] = useState<{
    environmentId: string
    attempt: number
    detail?: EnvironmentDetails
    error?: { message?: string }
  }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (environmentId)
      void environmentService.get(environmentId).then(
        (value) => {
          if (!cancelled) setLoaded({ environmentId, attempt, detail: value })
        },
        (cause: unknown) => {
          if (!cancelled)
            setLoaded({
              environmentId,
              attempt,
              error: { message: cause instanceof Error ? cause.message : undefined },
            })
        },
      )
    return () => {
      cancelled = true
    }
  }, [environmentId, attempt])
  const current =
    loaded?.environmentId === environmentId && loaded?.attempt === attempt ? loaded : undefined
  const detail = current?.detail
  const error = current?.error
  let content
  if (error)
    content = (
      <Alert variant="destructive">
        <AlertTitle>{t('env.notFound')}</AlertTitle>
        <AlertDescription>{error.message ?? t('env.operationError')}</AlertDescription>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {t('common.retry')}
          </Button>
          <Button variant="outline" render={<Link to="/environments" />}>
            {t('env.back')}
          </Button>
        </div>
      </Alert>
    )
  else if (environmentId && (!detail || detail.id !== environmentId))
    content = (
      <div className="mx-auto flex w-full min-w-0 flex-col gap-8" aria-busy="true">
        <Skeleton className="h-14" />
        <Skeleton className="h-64" />
        <Skeleton className="h-44" />
      </div>
    )
  else content = <EnvironmentEditor key={environmentId ?? 'new'} detail={detail} />
  return <div ref={ref}>{content}</div>
}
