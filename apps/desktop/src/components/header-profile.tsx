import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { CircleHelpIcon, LogOutIcon, RefreshCwIcon, SettingsIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAppData } from '@/app/use-app-data'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { appRoutes } from '@/shared/config/navigation'

export function HeaderProfile() {
  const { t } = useI18n()
  const { refresh, loading } = useAppData()
  const navigate = useNavigate()
  const [quitOpen, setQuitOpen] = useState(false)
  const goTo = (url: string) => void navigate({ to: url })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full p-0"
              aria-label={t('header.user')}
              title={t('header.user')}
            />
          }
        >
          <Avatar size="sm" className="size-6 after:hidden">
            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
              CW
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2">
              <Avatar size="lg">
                <AvatarFallback className="bg-primary font-semibold text-primary-foreground">
                  CW
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm font-medium">{t('header.localWorkspace')}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {t('header.localUser')}
                </span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => goTo(appRoutes.settings)}>
              <SettingsIcon data-icon="inline-start" />
              {t('header.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => goTo(appRoutes.about)}>
              <CircleHelpIcon data-icon="inline-start" />
              {t('header.about')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={loading} onClick={() => void refresh()}>
              <RefreshCwIcon data-icon="inline-start" />
              {t('header.refreshWorkspace')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setQuitOpen(true)}>
              <LogOutIcon data-icon="inline-start" />
              {t('header.quit')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={quitOpen} onOpenChange={setQuitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('header.quitConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('header.quitConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void window.contextweave.app.quit()}
            >
              {t('header.quit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
