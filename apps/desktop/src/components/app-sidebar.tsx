'use client'

import * as React from 'react'
import {
  ScrollTextIcon,
  BoxesIcon,
  TagsIcon,
  Globe2Icon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import type { ThemeLayout, ThemeSidebar } from '@contextweave/contracts'
import { NavMain } from '@/components/nav-main'
import { appRoutes } from '@/shared/config/navigation'
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar'
import { WorkspaceSwitcher } from '@/features/workspaces/components/workspace-switcher'
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
      icon: <Globe2Icon className="text-muted-foreground" />,
    },
    {
      title: t('nav.proxies'),
      url: appRoutes.proxies,
      icon: <SlidersHorizontalIcon className="text-muted-foreground" />,
    },
    {
      title: t('nav.tags'),
      url: appRoutes.tags,
      icon: <TagsIcon className="text-muted-foreground" />,
    },
    {
      title: t('nav.kernels'),
      url: appRoutes.kernels,
      icon: <BoxesIcon className="text-muted-foreground" />,
    },
  ]
  // Add system tools here; settings is appended separately to stay last.
  const systemItems = [
    {
      title: t('nav.activity'),
      url: appRoutes.activity,
      icon: <ScrollTextIcon className="text-muted-foreground" />,
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
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} groupLabel={t('nav.workspace')} />
        <NavMain
          items={[
            ...systemItems,
            {
              title: t('nav.settings'),
              url: appRoutes.settings,
              icon: <SettingsIcon className="text-muted-foreground" />,
            },
          ]}
          groupLabel={t('nav.system')}
        />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
