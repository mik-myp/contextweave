import { Link } from '@tanstack/react-router'
import type { EnvironmentSummary } from '@contextweave/contracts'
import { EllipsisIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { isEnvironmentReadOnly } from '../environment-service'

export function EnvironmentRowActions({
  environment,
  pending,
  onStart,
  onStop,
  onDelete,
}: {
  environment: EnvironmentSummary
  pending: boolean
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const active = environment.status === 'running' || environment.status === 'starting'
  const needsReview = environment.status === 'error' || environment.status === 'needs-recovery'
  return (
    <div className="flex items-center justify-end gap-1">
      {needsReview ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          render={
            <Link
              to="/environments/$environmentId/edit"
              params={{ environmentId: environment.id }}
            />
          }
        >
          {t('env.view')}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={
            environment.status === 'stopping' || (pending && environment.status !== 'starting')
          }
          onClick={active ? onStop : onStart}
        >
          {pending && <Spinner data-icon="inline-start" />}
          {environment.status === 'stopping'
            ? t('status.stopping')
            : t(active ? 'env.stop' : 'env.start')}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${t('env.actions')}：${environment.name}`}
              disabled={pending}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={
                <Link
                  to="/environments/$environmentId/edit"
                  params={{ environmentId: environment.id }}
                />
              }
            >
              {t(isEnvironmentReadOnly(environment.status) ? 'env.view' : 'env.edit')}
            </DropdownMenuItem>
            {environment.status === 'error' && (
              <DropdownMenuItem onClick={onStart}>{t('env.start')}</DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={isEnvironmentReadOnly(environment.status)}
              onClick={onDelete}
            >
              {t('life.op.trash')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
