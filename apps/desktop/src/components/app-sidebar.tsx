'use client'

import * as React from 'react'
import {
  ActivityIcon,
  BoxesIcon,
  Globe2Icon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import type { ThemeLayout, ThemeSidebar } from '@contextweave/contracts'
import { NavMain } from '@/components/nav-main'
import { appRoutes } from '@/shared/config/navigation'
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar'
import { TeamSwitcher } from './team-switcher'
import { useI18n } from '@/i18n'

export function AppSidebar({
  sidebar = 'sidebar',
  layout = 'default',
  ...props
}: React.ComponentProps<typeof Sidebar> & { sidebar?: ThemeSidebar; layout?: ThemeLayout }) {
  const { t } = useI18n()
  const navItems = [
    { title: t('nav.environments'), url: appRoutes.environments, icon: <Globe2Icon /> },
    { title: t('nav.proxies'), url: appRoutes.proxies, icon: <SlidersHorizontalIcon /> },
    { title: t('nav.kernels'), url: appRoutes.kernels, icon: <BoxesIcon /> },
    { title: t('nav.activity'), url: appRoutes.activity, icon: <ActivityIcon /> },
    { title: t('nav.settings'), url: appRoutes.settings, icon: <SettingsIcon /> },
  ]
  const collapsible = layout === 'offcanvas' ? 'offcanvas' : 'icon'
  return (
    <Sidebar
      collapsible={collapsible}
      variant={sidebar}
      role="complementary"
      aria-label={t('nav.workspace')}
      {...props}
    >
      <SidebarHeader className="h-16 justify-center">
        <TeamSwitcher teams={[]} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} groupLabel={t('nav.workspace')} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
