import { Outlet } from '@tanstack/react-router'
import { PageHeading } from '@/components/page-heading'
import { Separator } from '@/components/ui/separator'
import { useI18n } from '@/i18n'
import { SettingsNav } from '../components/settings-nav'

export function SettingsPage() {
  const { t } = useI18n()
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeading title={t('settings.title')} description={t('settings.description')} />
      <Separator />
      <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:gap-12">
        <aside className="hidden shrink-0 md:block lg:w-48">
          <SettingsNav />
        </aside>
        <div className="min-w-0 flex-1 pb-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
