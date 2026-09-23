import { Link, useLocation } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { useEnvironmentDrafts } from '../environment-draft-context'

export function EnvironmentDraftNotice() {
  const { resumeId } = useEnvironmentDrafts()
  const { pathname } = useLocation()
  const { t } = useI18n()
  if (!resumeId || pathname === '/environments/new' || pathname.endsWith('/edit')) return null
  return (
    <Alert>
      <AlertDescription>
        {t('env.draftKept')}
        <Button
          variant="link"
          size="sm"
          render={
            resumeId === 'new' ? (
              <Link to="/environments/new" />
            ) : (
              <Link to="/environments/$environmentId/edit" params={{ environmentId: resumeId }} />
            )
          }
        >
          {t('env.restoreDraft')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
