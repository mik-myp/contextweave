import { useId, useState } from 'react'
import { organizationNameKey, type EnvironmentTag } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

/** Uses the same persisted dictionary as /tags; free-text names are registered on save. */
export function TagCatalogPicker({
  tags,
  value,
  onChange,
  disabled,
}: {
  tags: EnvironmentTag[]
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const { t } = useI18n(),
    id = useId()
  const [search, setSearch] = useState('')
  const names = value
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
  const keys = new Set(names.map(organizationNameKey))
  const options = tags.filter((tag) => !keys.has(organizationNameKey(tag.name)))
  const blocked = disabled || names.length >= 20
  return (
    <Field data-disabled={blocked}>
      <FieldLabel htmlFor={id}>{t('tags.chooseExisting')}</FieldLabel>
      <Combobox<EnvironmentTag>
        items={options}
        value={null}
        inputValue={search}
        onInputValueChange={setSearch}
        itemToStringLabel={(tag) => tag.name}
        itemToStringValue={(tag) => tag.id}
        disabled={blocked}
        onValueChange={(tag) => {
          if (!tag) return
          onChange([...names, tag.name].join('\n'))
          setSearch('')
        }}
      >
        <ComboboxInput
          id={id}
          triggerAriaLabel={t('tags.chooseExisting')}
          placeholder={t('tags.search')}
          aria-describedby={`${id}-help`}
        />
        <ComboboxContent>
          <ComboboxEmpty>{t('common.noResults')}</ComboboxEmpty>
          <ComboboxList>
            {(tag) => (
              <ComboboxItem key={tag.id} value={tag}>
                {tag.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription id={`${id}-help`}>{t('tags.chooseHelp')}</FieldDescription>
    </Field>
  )
}
