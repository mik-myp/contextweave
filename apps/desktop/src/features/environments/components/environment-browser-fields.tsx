import { useState } from 'react'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { useI18n } from '@/i18n'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import type { EnvironmentFormValues } from '../environment-form'

const languages = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
]
const timezones = ['UTC', ...Intl.supportedValuesOf('timeZone')]

export function EnvironmentBrowserFields({
  disabled,
  expanded,
  onExpandedChange,
}: {
  disabled: boolean
  expanded: boolean
  onExpandedChange: (value: boolean) => void
}) {
  const { t } = useI18n()
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = useFormContext<EnvironmentFormValues>()
  const [language, timezone, width, height] = useWatch({
    control,
    name: ['language', 'timezone', 'width', 'height'],
  })
  const languageItems = [{ value: 'system', label: t('env.system') }, ...languages]
  if (!languageItems.some((item) => item.value === language))
    languageItems.push({ value: language, label: language })
  const zoneItems = [
    { value: 'system', label: t('env.system') },
    ...timezones.map((zone) => ({ value: zone, label: zone })),
  ]
  if (!zoneItems.some((item) => item.value === timezone))
    zoneItems.push({ value: timezone, label: timezone })
  const presets = [
    { value: '1440x900', label: t('env.defaultWindow') },
    { value: '1280x800', label: '1280 × 800' },
    { value: '1920x1080', label: '1920 × 1080' },
    { value: 'custom', label: t('env.customWindow') },
  ]
  const dimensions = `${width}x${height}`
  const [customWindow, setCustomWindow] = useState(false)
  return (
    <Accordion
      value={expanded ? ['browser'] : []}
      onValueChange={(value) => onExpandedChange(value.includes('browser'))}
    >
      <AccordionItem value="browser">
        <AccordionTrigger headerRender={<h2 />} className="items-center gap-4 py-0">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-base font-semibold">{t('env.browser')}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {t('env.browserSummary')
                .replace(
                  '{language}',
                  languageItems.find((item) => item.value === language)?.label ?? language,
                )
                .replace('{timezone}', timezone === 'system' ? t('env.system') : timezone)
                .replace('{size}', `${width || '—'} × ${height || '—'}`)}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent keepMounted>
          <FieldGroup className="max-w-2xl pt-(--form-field-gap)">
            <FieldDescription>{t('env.browserDescription')}</FieldDescription>
            <FieldGroup className="sm:flex-row">
              <Controller
                name="language"
                control={control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} data-disabled={disabled}>
                    <FieldLabel htmlFor="browser-language">{t('env.language')}</FieldLabel>
                    <Select
                      items={languageItems}
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={disabled}
                    >
                      <SelectTrigger
                        id="browser-language"
                        ref={field.ref}
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                        aria-describedby={fieldState.error ? 'browser-language-error' : undefined}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent aria-label={t('env.language')}>
                        <SelectGroup>
                          {languageItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError id="browser-language-error" errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="timezone"
                control={control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} data-disabled={disabled}>
                    <FieldLabel htmlFor="browser-timezone">{t('env.timezone')}</FieldLabel>
                    <Combobox
                      items={zoneItems}
                      value={zoneItems.find((item) => item.value === field.value) ?? null}
                      onValueChange={(value) => field.onChange(value?.value ?? '')}
                      itemToStringLabel={(item) => item.label}
                      itemToStringValue={(item) => item.value}
                      disabled={disabled}
                    >
                      <ComboboxInput
                        id="browser-timezone"
                        triggerAriaLabel={t('env.timezone')}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                        aria-describedby={fieldState.error ? 'browser-timezone-error' : undefined}
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
                    <FieldError id="browser-timezone-error" errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
            <FieldSet disabled={disabled}>
              <FieldLegend variant="label">{t('env.window')}</FieldLegend>
              <Select
                items={presets}
                value={
                  !customWindow && presets.some((item) => item.value === dimensions)
                    ? dimensions
                    : 'custom'
                }
                disabled={disabled}
                onValueChange={(value) => {
                  if (!value) return
                  setCustomWindow(value === 'custom')
                  if (value === 'custom') return
                  const [nextWidth, nextHeight] = value.split('x').map(Number)
                  setValue('width', nextWidth, { shouldDirty: true, shouldValidate: true })
                  setValue('height', nextHeight, { shouldDirty: true, shouldValidate: true })
                }}
              >
                <SelectTrigger aria-label={t('env.window')} className="w-full sm:max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent aria-label={t('env.window')}>
                  <SelectGroup>
                    {presets.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldGroup className="sm:flex-row">
                <Field data-invalid={!!errors.width} data-disabled={disabled}>
                  <FieldLabel htmlFor="browser-width">{t('env.width')}</FieldLabel>
                  <Input
                    id="browser-width"
                    type="number"
                    min={640}
                    max={7680}
                    step={1}
                    disabled={disabled}
                    aria-invalid={!!errors.width}
                    aria-describedby={errors.width ? 'browser-width-error' : undefined}
                    {...register('width', { valueAsNumber: true })}
                  />
                  <FieldError id="browser-width-error" errors={[errors.width]} />
                </Field>
                <Field data-invalid={!!errors.height} data-disabled={disabled}>
                  <FieldLabel htmlFor="browser-height">{t('env.height')}</FieldLabel>
                  <Input
                    id="browser-height"
                    type="number"
                    min={480}
                    max={4320}
                    step={1}
                    disabled={disabled}
                    aria-invalid={!!errors.height}
                    aria-describedby={errors.height ? 'browser-height-error' : undefined}
                    {...register('height', { valueAsNumber: true })}
                  />
                  <FieldError id="browser-height-error" errors={[errors.height]} />
                </Field>
              </FieldGroup>
              <FieldDescription>{t('env.windowHelp')}</FieldDescription>
            </FieldSet>
          </FieldGroup>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
