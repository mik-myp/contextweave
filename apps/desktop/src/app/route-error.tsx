import { useRef, useState } from 'react'
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { CircleAlertIcon, RefreshCwIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function RouteError({ reset }: ErrorComponentProps) {
  const { t } = useI18n()
  const router = useRouter()
  const active = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const recover = async (home: boolean) => {
    if (active.current) return
    active.current = true
    setPending(true)
    setFailed(false)
    try {
      if (home) await router.navigate({ to: '/environments' })
      else {
        // Invalidating reruns loaders; reset also handles errors thrown during rendering.
        await router.invalidate()
        reset()
      }
    } catch {
      setFailed(true)
    } finally {
      active.current = false
      setPending(false)
    }
  }
  return (
    <section
      className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6"
      aria-label={t('route.errorTitle')}
    >
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle role="heading" aria-level={1}>
          {t('route.errorTitle')}
        </AlertTitle>
        <AlertDescription>{t('route.errorDescription')}</AlertDescription>
      </Alert>
      {failed && <p role="status">{t('route.retryFailed')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void recover(false)}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {t('common.retry')}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => void recover(true)}>
          {t('route.backToEnvironments')}
        </Button>
      </div>
    </section>
  )
}
