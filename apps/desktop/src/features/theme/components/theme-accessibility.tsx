import { useId } from 'react'
import type { ThemeMotion, ThemeScale } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const scales = [90, 100, 110, 125] as const satisfies readonly ThemeScale[]

type ThemeAccessibilityProps = {
  scale: ThemeScale
  motion: ThemeMotion
  onScaleChange: (scale: ThemeScale) => void
  onMotionChange: (motion: ThemeMotion) => void
}

export function ThemeAccessibility({
  scale,
  motion,
  onScaleChange,
  onMotionChange,
}: ThemeAccessibilityProps) {
  const { t } = useI18n()
  const id = useId()

  return (
    <FieldGroup>
      <Field>
        <FieldContent>
          <FieldTitle id={`${id}-scale-label`}>{t('theme.scale')}</FieldTitle>
          <FieldDescription id={`${id}-scale-description`} className="text-start">
            {t('theme.scaleDescription')}
          </FieldDescription>
        </FieldContent>
        <ToggleGroup
          variant="outline"
          size="lg"
          spacing={0}
          className="w-full"
          value={[String(scale)]}
          onValueChange={(values) => {
            const nextScale = scales.find((option) => String(option) === values[0])
            if (nextScale !== undefined) onScaleChange(nextScale)
          }}
          aria-labelledby={`${id}-scale-label`}
          aria-describedby={`${id}-scale-description`}
        >
          {scales.map((option) => (
            <ToggleGroupItem
              key={option}
              value={String(option)}
              className="min-w-0 flex-1 tabular-nums"
            >
              {option}%
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Separator />
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={`${id}-motion`}>{t('theme.motionReduced')}</FieldLabel>
          <FieldDescription id={`${id}-motion-description`} className="text-start">
            {t('theme.motionDescription')}
          </FieldDescription>
          <p
            id={`${id}-motion-state`}
            className="mt-1 text-xs leading-relaxed text-muted-foreground"
          >
            {t(
              motion === 'reduced'
                ? 'theme.motionReducedDescription'
                : 'theme.motionSystemDescription',
            )}
          </p>
        </FieldContent>
        <Switch
          id={`${id}-motion`}
          className="mt-0.5"
          checked={motion === 'reduced'}
          onCheckedChange={(checked) => onMotionChange(checked ? 'reduced' : 'system')}
          aria-describedby={`${id}-motion-description ${id}-motion-state`}
        />
      </Field>
    </FieldGroup>
  )
}
