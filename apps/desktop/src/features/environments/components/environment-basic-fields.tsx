import { Controller, useFormContext } from 'react-hook-form'
import { useI18n } from '@/i18n'
import { FormSection } from '@/components/form-section'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { KernelSummary } from '@/shared/types/app'
import type { EnvironmentFormValues } from '../environment-form'

export function EnvironmentBasicFields({
  kernels,
  disabled,
  editing,
  kernelVersion,
  onManage,
}: {
  kernels: KernelSummary[]
  disabled: boolean
  editing: boolean
  kernelVersion?: string
  onManage: () => void
}) {
  const { t } = useI18n()
  const {
    control,
    register,
    formState: { errors },
    watch,
  } = useFormContext<EnvironmentFormValues>()
  const kernelId = watch('kernelId')
  const selected = kernels.find((kernel) => kernel.id === kernelId)
  const available = kernels.filter((kernel) => kernel.status === 'available')
  const version = editing ? kernelVersion : selected?.version
  const source = version === 'local' ? t('env.localKernel') : version
  const items = [
    { value: '', label: t('env.chooseKernel') },
    ...kernels.map((kernel) => ({ value: kernel.id, label: kernel.label })),
  ]
  if (kernelId && !selected) items.push({ value: kernelId, label: kernelId })
  return (
    <FormSection title={t('env.basic')} description={t('env.basicDescription')}>
      <Field data-invalid={!!errors.name} data-disabled={disabled}>
        <FieldLabel htmlFor="environment-name">{t('env.name')}</FieldLabel>
        <Input
          id="environment-name"
          autoComplete="off"
          maxLength={80}
          placeholder={t('env.namePlaceholder')}
          disabled={disabled}
          aria-invalid={!!errors.name}
          aria-describedby={
            errors.name ? 'environment-name-help environment-name-error' : 'environment-name-help'
          }
          {...register('name')}
        />
        <FieldDescription id="environment-name-help">{t('env.nameDescription')}</FieldDescription>
        <FieldError id="environment-name-error" errors={[errors.name]} />
      </Field>
      <Controller
        name="kernelId"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} data-disabled={disabled || editing}>
            <FieldLabel htmlFor="environment-kernel">{t('env.kernel')}</FieldLabel>
            <Select
              items={items}
              value={field.value}
              onValueChange={(value) => field.onChange(value ?? '')}
              disabled={disabled || editing}
            >
              <SelectTrigger
                id="environment-kernel"
                ref={field.ref}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
                aria-describedby={
                  fieldState.error
                    ? 'environment-kernel-help environment-kernel-error'
                    : 'environment-kernel-help'
                }
                className="w-full sm:max-w-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent aria-label={t('env.kernel')}>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={!available.some((kernel) => kernel.id === item.value)}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription id="environment-kernel-help">
              {editing
                ? `${t('env.kernelLocked')} ${t('env.kernelSource')}：${source ?? kernelId}`
                : selected
                  ? `${t('env.kernelSource')}：${version === 'local' ? source : `${t('env.managedKernel')} · ${source}`}`
                  : t('env.kernelHint')}
            </FieldDescription>
            <FieldError id="environment-kernel-error" errors={[fieldState.error]} />
          </Field>
        )}
      />
      {!editing && available.length === 0 && (
        <Alert>
          <AlertTitle>{t('env.noKernel')}</AlertTitle>
          <AlertDescription>{t('env.noKernelDescription')}</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={onManage} disabled={disabled}>
            {t('env.manageKernels')}
          </Button>
        </Alert>
      )}
    </FormSection>
  )
}
