import { useId, type ReactNode } from 'react'
import { FieldGroup } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'

export function SettingsSection({
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
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-medium">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Separator />
      </div>
      <FieldGroup className="max-w-xl">{children}</FieldGroup>
    </section>
  )
}
