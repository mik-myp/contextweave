import { Controller, useFormContext } from 'react-hook-form'
import { useI18n } from '@/i18n'
import { FormSection } from '@/components/form-section'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ProxySummary } from '@/shared/types/app'
import type { EnvironmentFormValues } from '../environment-form'

export function EnvironmentProxyFields({
  proxies,
  disabled,
  onManage,
}: {
  proxies: ProxySummary[]
  disabled: boolean
  onManage: () => void
}) {
  const { t } = useI18n()
  const { control, watch } = useFormContext<EnvironmentFormValues>()
  const usesProxy = watch('connection') === 'proxy'
  const proxyId = watch('proxyId')
  const options = proxies.map((proxy) => ({
    value: proxy.proxyId,
    label: `${proxy.type.toUpperCase()} · ${proxy.host}:${proxy.port}`,
  }))
  if (proxyId && !options.some((option) => option.value === proxyId))
    options.push({ value: proxyId, label: proxyId })
  return (
    <FormSection title={t('env.network')} description={t('env.networkDescription')}>
      <Controller
        name="connection"
        control={control}
        render={({ field }) => (
          <Field data-disabled={disabled}>
            <FieldLabel id="connection-label">{t('env.connection')}</FieldLabel>
            <ToggleGroup
              variant="outline"
              spacing={0}
              value={[field.value]}
              onValueChange={(value) => {
                if (value[0]) field.onChange(value[0])
              }}
              disabled={disabled}
              aria-labelledby="connection-label"
              className="w-fit"
            >
              <ToggleGroupItem value="direct">{t('env.direct')}</ToggleGroupItem>
              <ToggleGroupItem value="proxy">{t('env.useProxy')}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        )}
      />
      {usesProxy && (
        <Controller
          name="proxyId"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} data-disabled={disabled}>
              <FieldLabel htmlFor="environment-proxy">{t('env.proxy')}</FieldLabel>
              <Combobox
                items={options}
                value={options.find((item) => item.value === field.value) ?? null}
                onValueChange={(value) => field.onChange(value?.value ?? '')}
                itemToStringLabel={(item) => item.label}
                itemToStringValue={(item) => item.value}
                disabled={disabled}
              >
                <ComboboxInput
                  id="environment-proxy"
                  triggerAriaLabel={t('env.chooseProxy')}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  placeholder={t('env.chooseProxy')}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.error ? 'environment-proxy-error' : undefined}
                />
                <ComboboxContent>
                  <ComboboxEmpty>{t('env.noOptions')}</ComboboxEmpty>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {!!proxyId && !proxies.some((proxy) => proxy.proxyId === proxyId) && (
                <FieldDescription>{t('env.missingProxy')}</FieldDescription>
              )}
              <FieldError id="environment-proxy-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
      )}
      {usesProxy && proxies.length === 0 && (
        <Alert>
          <AlertTitle>{t('env.noProxy')}</AlertTitle>
          <AlertDescription>{t('env.noProxyDescription')}</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={onManage} disabled={disabled}>
            {t('env.manageProxies')}
          </Button>
        </Alert>
      )}
    </FormSection>
  )
}
