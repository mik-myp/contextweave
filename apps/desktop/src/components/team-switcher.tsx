'use client'

import * as React from 'react'
import { ChevronsUpDownIcon, PaletteIcon, PlusIcon } from 'lucide-react'
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

type Team = {
  name: string
  logo: React.ReactNode
  plan: string
}

type TeamSwitcherProps = {
  teams: Team[]
  onTeamChange?: (team: Team) => void
  onAddTeam?: () => void
}

export function TeamSwitcher({ teams, onTeamChange, onAddTeam }: TeamSwitcherProps) {
  const { t } = useI18n()
  const { isMobile } = useSidebar()
  const [activeTeamName, setActiveTeamName] = React.useState<string | undefined>(teams[0]?.name)
  const activeTeam = teams.find((team) => team.name === activeTeamName) ?? teams[0]
  const hasMenu = teams.length > 0 || Boolean(onAddTeam)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!hasMenu}
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground disabled:opacity-100"
              />
            }
          >
            <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              {activeTeam?.logo ?? <PaletteIcon className="size-4" aria-hidden="true" />}
            </div>
            <div className="grid min-w-0 flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{activeTeam?.name ?? 'ContextWeave'}</span>
              <span className="truncate text-xs">
                {activeTeam?.plan ?? t('header.localWorkspace')}
              </span>
            </div>
            {hasMenu && <ChevronsUpDownIcon className="ms-auto" aria-hidden="true" />}
          </DropdownMenuTrigger>
          {hasMenu && (
            <DropdownMenuContent
              className="min-w-56"
              align="start"
              side={isMobile ? 'bottom' : 'inline-end'}
              sideOffset={4}
            >
              {teams.length > 0 && (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t('teamSwitcher.teams')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={activeTeam?.name}
                    onValueChange={(name) => {
                      const team = teams.find((item) => item.name === name)
                      if (team) {
                        setActiveTeamName(team.name)
                        onTeamChange?.(team)
                      }
                    }}
                  >
                    {teams.map((team) => (
                      <DropdownMenuRadioItem
                        key={team.name}
                        value={team.name}
                        closeOnClick
                        className="gap-2 py-2 ps-2"
                      >
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                          {team.logo}
                        </div>
                        <span className="truncate">{team.name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              )}
              {onAddTeam && (
                <>
                  {teams.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={onAddTeam} className="gap-2 p-2">
                      <div className="flex size-6 items-center justify-center rounded-md border">
                        <PlusIcon aria-hidden="true" />
                      </div>
                      {t('teamSwitcher.addTeam')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
