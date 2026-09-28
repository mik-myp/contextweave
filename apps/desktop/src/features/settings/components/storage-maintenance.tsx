import { useState } from 'react'
import { ChevronDownIcon, HistoryIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { HistoryCleanup } from './history-cleanup'

export function StorageMaintenance() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setHasOpened(true)
      }}
      render={<Card />}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('cleanup.title')}
        </CardTitle>
        <CardDescription>{t('storage.maintenanceHelp')}</CardDescription>
        <CollapsibleTrigger render={<Button variant="outline" size="sm" className="mt-2 w-fit" />}>
          {t(open ? 'storage.hideMaintenance' : 'storage.showMaintenance')}
          <ChevronDownIcon data-icon="inline-end" />
        </CollapsibleTrigger>
      </CardHeader>
      <CollapsibleContent keepMounted>
        {hasOpened && (
          <CardContent>
            <HistoryCleanup showHeading={false} />
          </CardContent>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
