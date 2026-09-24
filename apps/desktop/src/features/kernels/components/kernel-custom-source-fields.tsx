import { useI18n } from '@/i18n'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
export type KernelSourceDraft = {
  url: string
  version: string
  sha256: string
  trustedSource: boolean
}
export function KernelCustomSourceFields({
  value,
  onChange,
  disabled,
}: {
  value: KernelSourceDraft
  onChange: (value: KernelSourceDraft) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="kernel-download-url">{t('kernel.downloadUrl')}</FieldLabel>
        <Input
          id="kernel-download-url"
          type="url"
          dir="ltr"
          autoComplete="off"
          placeholder="https://…"
          value={value.url}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, url: event.target.value })}
        />
        <FieldDescription>{t('kernel.customLinkHelp')}</FieldDescription>
      </Field>
      <FieldGroup className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field>
          <FieldLabel htmlFor="kernel-custom-version">{t('kernel.version')}</FieldLabel>
          <Input
            id="kernel-custom-version"
            dir="ltr"
            placeholder="148.0.7778.215"
            value={value.version}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, version: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="kernel-custom-sha">SHA-256</FieldLabel>
          <Input
            id="kernel-custom-sha"
            dir="ltr"
            className="font-mono text-xs"
            maxLength={64}
            value={value.sha256}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, sha256: event.target.value })}
          />
        </Field>
      </FieldGroup>
      <Field orientation="horizontal">
        <Checkbox
          id="kernel-source-trust"
          checked={value.trustedSource}
          disabled={disabled}
          onCheckedChange={(trustedSource) => onChange({ ...value, trustedSource })}
        />
        <FieldLabel htmlFor="kernel-source-trust" className="text-sm font-normal leading-relaxed">
          {t('kernel.trustSource')}
        </FieldLabel>
      </Field>
    </FieldGroup>
  )
}
