'use client'

import * as React from 'react'
import {
  ScrollTextIcon,
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
    {
      title: t('nav.environments'),
      url: appRoutes.environments,
      icon: <Globe2Icon className="text-sky-600 dark:text-sky-400" />,
    },
    {
      title: t('nav.proxies'),
      url: appRoutes.proxies,
      icon: <SlidersHorizontalIcon className="text-violet-600 dark:text-violet-400" />,
    },
    {
      title: t('nav.kernels'),
      url: appRoutes.kernels,
      icon: <BoxesIcon className="text-amber-600 dark:text-amber-400" />,
    },
  ]
  // Add system tools here; settings is appended separately to stay last.
  const systemItems = [
    {
      title: t('nav.activity'),
      url: appRoutes.activity,
      icon: <ScrollTextIcon className="text-emerald-600 dark:text-emerald-400" />,
    },
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
        <NavMain
          items={[
            ...systemItems,
            {
              title: t('nav.settings'),
              url: appRoutes.settings,
              icon: <SettingsIcon className="text-slate-500 dark:text-slate-400" />,
            },
          ]}
          groupLabel={t('nav.system')}
        />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
