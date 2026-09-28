import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useI18n } from '@/i18n'
import { EnvironmentCommands } from './environment-commands'

export function CommandHistorySheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-4xl">
        <SheetHeader className="pe-12">
          <SheetTitle>{t('commands.title')}</SheetTitle>
          <SheetDescription>{t('commands.help')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <EnvironmentCommands />
        </div>
      </SheetContent>
    </Sheet>
  )
}
