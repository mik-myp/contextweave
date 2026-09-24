import { useFormContext, useWatch } from 'react-hook-form'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import type { EnvironmentFormValues } from '../environment-form'
import { useIpLocale } from '../hooks/use-ip-locale'

export function EnvironmentLocaleDetection({ disabled }: { disabled: boolean }) {
  const { t } = useI18n()
  const { control, setValue } = useFormContext<EnvironmentFormValues>()
  const [connection, proxyId] = useWatch({ control, name: ['connection', 'proxyId'] })
  const detection = useIpLocale(connection, proxyId)
  const result = detection.result
  return (
    <Field>
      <FieldLabel>{t('env.ipLocaleTitle')}</FieldLabel>
      <FieldDescription>{t('env.ipLocaleDescription')}</FieldDescription>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || detection.busy || (connection === 'proxy' && !proxyId)}
          onClick={() => void detection.detect()}
        >
          {detection.busy && <Spinner data-icon="inline-start" />}
          {t(detection.busy ? 'env.ipLocaleDetecting' : 'env.ipLocaleDetect')}
        </Button>
        {detection.busy && (
          <Button type="button" variant="ghost" onClick={detection.cancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {detection.error && (
          <Alert variant="destructive">
            <AlertTitle>{t('env.ipLocaleFailed')}</AlertTitle>
            <AlertDescription>{detection.error}</AlertDescription>
          </Alert>
        )}
        {result && (
          <Alert>
            <AlertTitle>
              {t(result.connection === 'proxy' ? 'env.ipLocaleProxy' : 'env.ipLocaleDirect')}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>
                {result.ip} · {result.countryCode} · {result.timezone} · {result.language}
              </p>
              <p>{t('env.ipLocaleResultHint')}</p>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setValue('language', result.language, { shouldDirty: true, shouldValidate: true })
                  setValue('timezone', result.timezone, { shouldDirty: true, shouldValidate: true })
                }}
              >
                {t('env.ipLocaleApply')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </Field>
  )
}
