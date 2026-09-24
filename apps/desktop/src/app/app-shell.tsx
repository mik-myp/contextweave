import { EnvironmentDraftNotice } from '@/features/environments/components/environment-draft-notice'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster, toast } from '@/components/ui/toast'
import { HeaderLanguage } from '@/components/header-language'
import { HeaderProfile } from '@/components/header-profile'
import { HeaderSearch } from '@/components/header-search'
import { HeaderTheme } from '@/components/header-theme'
import { useTheme } from '@/features/theme/theme-provider'
import { useThemeSidebar } from '@/features/theme/use-theme-sidebar'
import { ThemeSaveNotice } from '@/features/theme/components/theme-save-notice'
import { useI18n } from '@/i18n'
import { useAppData } from './use-app-data'
import { cn } from '@/lib/utils'

export function AppShell() {
  const { theme } = useTheme()
  const hasContainedViewport = useRouterState({
    select: (state) => {
      const pathname = state.location.pathname.replace(/\/$/, '')
      return (
        pathname.startsWith('/settings') ||
        ['/environments', '/proxies', '/kernels', '/activity'].includes(pathname)
      )
    },
  })
  const { notice, setNotice } = useAppData()
  const { t } = useI18n()
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useThemeSidebar()
  const lastNotice = useRef<typeof notice>(undefined)

  useEffect(() => {
    if (!notice || lastNotice.current === notice) return
    lastNotice.current = notice
    toast.add({
      type: notice.kind === 'error' ? 'error' : 'success',
      description: notice.message,
    })
    setNotice(undefined)
  }, [notice, setNotice])

  return (
    <TooltipProvider>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className="h-svh overflow-hidden"
      >
        <Toaster closeLabel={t('common.close')} />
        <ThemeSaveNotice />
        <AppSidebar
          sidebar={theme.sidebar}
          layout={theme.layout}
          side={theme.direction === 'rtl' ? 'right' : 'left'}
        />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
            <SidebarTrigger className="-ms-1" aria-label={t('header.toggleSidebar')} />
            <div className="flex items-center gap-1 sm:gap-2">
              <HeaderSearch />
              <HeaderLanguage />
              <HeaderTheme />
              <HeaderProfile />
            </div>
          </header>
          <div
            data-scroll-restoration
            className={cn(
              'flex min-h-0 flex-1 flex-col bg-background p-4 md:p-(--page-padding)',
              hasContainedViewport ? 'overflow-hidden' : 'overflow-auto',
            )}
          >
            <div
              className={cn(
                'mx-auto flex w-full min-w-0 flex-1 flex-col gap-6',
                hasContainedViewport && 'min-h-0',
                theme.contentWidth === 'centered' ? 'max-w-5xl' : 'max-w-none',
              )}
            >
              <EnvironmentDraftNotice />
              <Outlet />
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
