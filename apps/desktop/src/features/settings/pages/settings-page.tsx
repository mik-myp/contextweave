import { Outlet } from '@tanstack/react-router'
import { SettingsNav } from '../components/settings-nav'

export function SettingsPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 md:flex-row md:gap-10">
      <aside
        className="shrink-0 overflow-auto overscroll-contain md:w-44"
        data-slot="settings-navigation"
      >
        <SettingsNav />
      </aside>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pe-2 pb-6"
        data-slot="settings-content"
      >
        <Outlet />
      </div>
    </div>
  )
}
