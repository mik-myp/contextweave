import { Outlet } from '@tanstack/react-router'
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
import { cn } from 'cn'

export function AppShell() {
  const { theme } = useTheme()
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
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <Toaster closeLabel={t('common.close')} />
        <ThemeSaveNotice />
        <AppSidebar
          sidebar={theme.sidebar}
          layout={theme.layout}
          side={theme.direction === 'rtl' ? 'right' : 'left'}
        />
        <SidebarInset>
          <header className="flex justify-between h-12 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <SidebarTrigger className="-ms-1" aria-label={t('header.toggleSidebar')} />
            <div className="flex items-center gap-1 sm:gap-2">
              <HeaderSearch />
              <HeaderLanguage />
              <HeaderTheme />
              <HeaderProfile />
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-muted/20 p-4 md:p-6">
            <div
              className={cn(
                'mx-auto flex w-full flex-1 flex-col gap-6',
                theme.contentWidth === 'centered' ? 'max-w-[92.5rem]' : 'max-w-none',
              )}
            >
              <Outlet />
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
