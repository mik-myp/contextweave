import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Separator } from '@/components/ui/separator'
import { ArtifactBudget } from './artifact-budget'
import { ArtifactInventory } from './artifact-inventory'

export function StorageDiagnostics() {
  const { t } = useI18n()
  const [hasOpened, setHasOpened] = useState(false)
  return (
    <details
      onToggle={(event) => {
        // Keep mounted after first use so collapsing cannot discard an edit or pending save.
        if (event.currentTarget.open) setHasOpened(true)
      }}
    >
      <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        {t('storage.diagnostics')}
      </summary>
      {hasOpened && (
        <div className="mt-4 flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">{t('storage.diagnosticsHelp')}</p>
          <ArtifactBudget />
          <Separator />
          <ArtifactInventory />
        </div>
      )}
    </details>
  )
}
