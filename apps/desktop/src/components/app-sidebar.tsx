'use client'

import * as React from 'react'
import {
  ActivityIcon,
  BoxesIcon,
  FingerprintIcon,
  Globe2Icon,
  PaletteIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import type { SidebarLayout } from '@contextweave/contracts'
import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import { TeamSwitcher } from '@/components/team-switcher'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'

const navItems = [
  { title: '环境', url: '#environments', icon: <Globe2Icon /> },
  { title: '代理', url: '#proxies', icon: <SlidersHorizontalIcon /> },
  { title: '内核', url: '#kernels', icon: <BoxesIcon /> },
  { title: '设置', url: '#settings', icon: <Settings2Icon /> },
  { title: '运行记录', url: '#activity', icon: <ActivityIcon /> },
  { title: '指纹策略', url: '#fingerprints', icon: <FingerprintIcon /> },
]

export function AppSidebar({
  activeItem,
  onSelect,
  layout = 'sidebar',
  ...props
}: Omit<React.ComponentProps<typeof Sidebar>, 'onSelect'> & {
  activeItem: string
  onSelect: (title: string) => void
  layout?: SidebarLayout
}) {
  const collapsible = layout === 'offcanvas' ? 'offcanvas' : 'icon'
  const variant = layout === 'offcanvas' ? 'sidebar' : layout
  return (
    <Sidebar collapsible={collapsible} variant={variant} {...props}>
      <SidebarHeader>
        <TeamSwitcher
          teams={[
            {
              name: 'ContextWeave',
              logo: <PaletteIcon />,
              plan: '个人工作区',
            },
          ]}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} activeItem={activeItem} onSelect={onSelect} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: '本地用户', email: '个人环境', avatar: '' }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
