'use client'

import * as React from 'react'
import {
  ActivityIcon,
  BoxesIcon,
  Globe2Icon,
  PaletteIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import type { SidebarLayout } from '@contextweave/contracts'
import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import { appRoutes } from '@/shared/config/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'

const navItems = [
  { title: '环境', url: appRoutes.environments, icon: <Globe2Icon /> },
  { title: '代理', url: appRoutes.proxies, icon: <SlidersHorizontalIcon /> },
  { title: '内核', url: appRoutes.kernels, icon: <BoxesIcon /> },
  { title: '运行记录', url: appRoutes.activity, icon: <ActivityIcon /> },
]

export function AppSidebar({
  layout = 'sidebar',
  ...props
}: React.ComponentProps<typeof Sidebar> & { layout?: SidebarLayout }) {
  const collapsible = layout === 'offcanvas' ? 'offcanvas' : 'icon'
  const variant = layout === 'offcanvas' ? 'sidebar' : layout
  return (
    <Sidebar collapsible={collapsible} variant={variant} {...props}>
      <SidebarHeader>
        {/* TeamSwitcher is reserved for the team edition and intentionally hidden in the personal edition. */}
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <PaletteIcon className="size-4" />
          </div>
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]/sidebar-wrapper:hidden">
            <span className="truncate font-medium">ContextWeave</span>
            <span className="truncate text-xs text-sidebar-foreground/70">个人工作区</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: '本地用户', email: '个人环境', avatar: '' }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
