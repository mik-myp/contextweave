import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { ChevronRightIcon } from 'lucide-react'
import { isRouteActive } from '@/lib/navigation'

type NavItem = {
  title: string
  url: string
  icon?: ReactNode
  isActive?: boolean
  items?: { title: string; url: string }[]
}

export function NavMain({
  items,
  groupLabel = 'Workspace',
}: {
  items: NavItem[]
  groupLabel?: string
}) {
  const location = useRouterState({ select: (state) => state.location })
  const renderItem = (item: NavItem) =>
    item.items?.length ? (
      <Collapsible
        key={item.title}
        defaultOpen={item.isActive}
        className="group/collapsible"
        render={<SidebarMenuItem />}
      >
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              tooltip={item.title}
              isActive={isRouteActive(location.pathname, item.url)}
            />
          }
        >
          {item.icon}
          <span>{item.title}</span>
          <ChevronRightIcon className="ms-auto transition-transform duration-200 group-data-open/collapsible:rotate-90 rtl:rotate-180 rtl:group-data-open/collapsible:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  isActive={isRouteActive(location.pathname, subItem.url)}
                  render={<Link to={subItem.url} />}
                >
                  <span>{subItem.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    ) : (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          tooltip={item.title}
          isActive={isRouteActive(location.pathname, item.url)}
          render={<Link to={item.url} />}
        >
          {item.icon}
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
      <SidebarMenu className="gap-1">{items.map(renderItem)}</SidebarMenu>
    </SidebarGroup>
  )
}
