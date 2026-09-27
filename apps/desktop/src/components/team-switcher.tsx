'use client'

import { ChevronsUpDownIcon, HardDriveIcon, RefreshCwIcon } from 'lucide-react'
import type { LocalWorkspace } from '@contextweave/contracts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'

type TeamSwitcherProps = {
  workspace: LocalWorkspace | undefined
  isPending: boolean
  isFetching: boolean
  hasError: boolean
  onRetry: () => void
}

// Preserve the planned switcher entry without inventing teams, remote connections or a second space.
export function TeamSwitcher({
  workspace,
  isPending,
  isFetching,
  hasError,
  onRetry,
}: TeamSwitcherProps) {
  const { t } = useI18n()
  const { isMobile } = useSidebar()
  const content = (
    <>
      <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <HardDriveIcon className="size-4" aria-hidden="true" />
      </div>
      <div className="grid min-w-0 flex-1 text-start text-sm leading-tight">
        <span className="truncate font-medium">
          {workspace
            ? t('header.localWorkspace')
            : t(isPending ? 'workspace.loading' : 'workspace.unavailable')}
        </span>
        <span className="truncate text-xs">
          {workspace
            ? t('workspace.localStorage')
            : t(hasError ? 'workspace.retry' : 'workspace.readingIdentity')}
        </span>
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {!workspace ? (
          <SidebarMenuButton
            size="lg"
            disabled={isFetching}
            onClick={onRetry}
            aria-label={t(hasError ? 'workspace.retry' : 'workspace.loading')}
            aria-busy={isFetching}
          >
            {content}
          </SidebarMenuButton>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<SidebarMenuButton size="lg" aria-label={t('workspace.details')} />}
            >
              {content}
              <ChevronsUpDownIcon className="ms-auto" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="min-w-64"
              align="start"
              side={isMobile ? 'bottom' : 'inline-end'}
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('header.workspace')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={workspace.workspaceId}>
                  <DropdownMenuRadioItem value={workspace.workspaceId} closeOnClick>
                    <HardDriveIcon aria-hidden="true" />
                    {t('header.localWorkspace')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('workspace.identity')}</DropdownMenuLabel>
                <div className="flex max-w-80 flex-col gap-2 px-2 pb-2 text-xs">
                  <code data-workspace-id={workspace.workspaceId} className="select-text break-all">
                    {workspace.workspaceId}
                  </code>
                  <p className="text-muted-foreground">{t('workspace.scope')}</p>
                </div>
                <DropdownMenuItem disabled={isFetching} onClick={onRetry}>
                  <RefreshCwIcon aria-hidden="true" />
                  {t('common.refresh')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
