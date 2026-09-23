import { CopyIcon } from 'lucide-react'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import type { AppPaths } from '@/shared/types/app'
import { Field, FieldLabel } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsSection } from '../components/settings-section'

const pathKeys: Array<keyof AppPaths> = [
  'dataRoot',
  'environmentRoot',
  'kernelRoot',
  'logRoot',
  'userData',
]

export function SettingsStoragePage() {
  const { t } = useI18n()
  const { paths, appInfo, appError, loading, refresh, setNotice } = useAppData()
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice({ kind: 'success', message: t('admin.copied') })
    } catch {
      setNotice({ kind: 'error', message: t('admin.operationError') })
    }
  }
  return (
    <SettingsSection title={t('settings.storage')} description={t('settings.storageDescription')}>
      {loading ? (
        <Skeleton className="h-40" />
      ) : appError ? (
        <Alert variant="destructive">
          <AlertDescription>{appError}</AlertDescription>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <Field>
            <FieldLabel>{t('settings.security')}</FieldLabel>
            <div>
              <Badge variant={appInfo?.secureStorageAvailable ? 'secondary' : 'outline'}>
                {t(
                  appInfo?.secureStorageAvailable
                    ? 'settings.secureAvailable'
                    : 'settings.secureUnavailable',
                )}
              </Badge>
            </div>
          </Field>
          <dl className="flex flex-col gap-5">
            {pathKeys.map((key) => (
              <div key={key} className="flex flex-col gap-1">
                <dt className="text-sm font-medium">{t(`settings.${key}`)}</dt>
                <dd className="flex items-center justify-between gap-3">
                  <span
                    dir="ltr"
                    className="min-w-0 break-all font-mono text-xs text-muted-foreground"
                  >
                    {paths?.[key] ?? t('admin.unavailable')}
                  </span>
                  {paths?.[key] && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${t('admin.copy')} ${t(`settings.${key}`)}`}
                      onClick={() => void copy(paths[key])}
                    >
                      <CopyIcon />
                    </Button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </SettingsSection>
  )
}
