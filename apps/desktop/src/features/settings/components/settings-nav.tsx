import { Link } from '@tanstack/react-router'
import { HardDriveIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export function SettingsNav() {
  const { t } = useI18n()
  return (
    <nav aria-label={t('settings.sections')} className="flex gap-1 lg:flex-col">
      <Link
        to="/settings/storage"
        activeOptions={{ exact: true }}
        className={cn(buttonVariants({ variant: 'ghost' }), 'justify-start')}
        activeProps={{ className: 'bg-muted' }}
      >
        <HardDriveIcon data-icon="inline-start" aria-hidden="true" />
        {t('settings.storage')}
      </Link>
    </nav>
  )
}
