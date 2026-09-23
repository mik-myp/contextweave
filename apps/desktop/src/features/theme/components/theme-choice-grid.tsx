import type { ReactNode } from 'react'
import { CircleCheckIcon } from 'lucide-react'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { cn } from 'cn'

export type Choice<T extends string | number> = {
  value: T
  label: string
  preview: ReactNode
  ariaLabel?: string
}

type GridColumns = 2 | 3 | 4 | 6
type GridGap = 2 | 3 | 4

/**
 * The preview frame follows the same visual hierarchy as new-api: the frame
 * carries selection state, while the label remains outside the frame.
 */
export function ChoiceGrid<T extends string | number>({
  value,
  choices,
  onChange,
  columns = 3,
  gap = 4,
  ariaLabel,
  previewSize = 'compact',
}: {
  value: T
  choices: Choice<T>[]
  onChange: (value: T) => void
  columns?: GridColumns
  gap?: GridGap
  ariaLabel?: string
  previewSize?: 'compact' | 'illustration'
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      className={cn(
        'grid w-full',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-3',
        columns === 4 && 'grid-cols-4',
        columns === 6 && 'grid-cols-6',
        gap === 2 && 'gap-2',
        gap === 3 && 'gap-3',
        gap === 4 && 'gap-4',
      )}
      aria-label={ariaLabel}
    >
      {choices.map((choice) => {
        const selected = value === choice.value
        return (
          <Radio.Root
            key={String(choice.value)}
            value={choice.value}
            render={<button type="button" />}
            nativeButton
            aria-label={choice.ariaLabel ?? choice.label}
            data-selected={selected}
            className="group flex min-w-0 flex-col items-stretch text-start outline-none"
          >
            <span
              className={cn(
                'relative overflow-visible rounded-md bg-background ring-1 ring-border transition-[box-shadow,color] duration-200',
                previewSize === 'illustration' ? 'h-[4.5rem]' : 'h-12',
                'group-hover:ring-primary/60',
                'group-focus-visible:ring-2 group-focus-visible:ring-ring',
                'group-data-[selected=true]:ring-primary group-data-[selected=true]:shadow-md',
              )}
            >
              <span className="absolute inset-0 overflow-hidden rounded-md">{choice.preview}</span>
              {selected && (
                <CircleCheckIcon
                  className="absolute top-0 end-0 z-10 size-5 translate-x-1/2 rtl:-translate-x-1/2 -translate-y-1/2 fill-primary stroke-primary-foreground"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="mt-1.5 truncate text-center text-xs leading-4 text-foreground">
              {choice.label}
            </span>
          </Radio.Root>
        )
      })}
    </RadioGroup>
  )
}
