import { useId, type ReactNode } from 'react'
import { FieldGroup } from '@/components/ui/field'

/** A continuous form section, shared by configuration pages. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-(--form-field-gap)">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <FieldGroup className="w-full">{children}</FieldGroup>
    </section>
  )
}
