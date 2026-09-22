import { RefreshCwIcon } from 'lucide-react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster, toast } from '@/components/ui/toast'
import { useTheme } from '@/theme'
import { useAppData } from './use-app-data'
import { pageLabels } from '@/shared/config/navigation'

export function AppShell() {
  const { theme } = useTheme()
  const { notice, setNotice, loading, refresh } = useAppData()
  const location = useRouterState({ select: (state) => state.location })
  const pageLabel = pageLabels[location.pathname] ?? '环境'

  useEffect(() => {
    if (!notice) return
    const toastId = toast.add({
      type: notice.kind === 'error' ? 'error' : 'success',
      description: notice.message,
    })
    setNotice(undefined)
    return () => toast.close(toastId)
  }, [notice, setNotice])

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Toaster />
        <AppSidebar layout={theme.sidebarLayout} />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="truncate text-sm font-medium">ContextWeave</div>
              <span className="text-muted-foreground">/</span>
              <div className="truncate text-sm text-muted-foreground">{pageLabel}</div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} aria-label="刷新">
              <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
            </Button>
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-muted/20 p-4 md:p-6">
            <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-6">
              <Outlet />
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
