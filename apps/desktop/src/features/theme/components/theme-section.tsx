import type { ReactNode } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { useI18n } from '@/i18n'

export function ThemeSection({
  title,
  onReset,
  showReset,
  children,
}: {
  title: string
  onReset: () => void
  showReset: boolean
  children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
        {showReset && (
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onReset}
            aria-label={t('common.reset')}
            title={t('common.reset')}
          >
            <RotateCcwIcon className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}
