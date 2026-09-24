import type { ReactElement } from 'react'
import { EllipsisIcon, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type DataTableRowAction = {
  id: string
  label: string
  icon: LucideIcon
  onClick?: () => void
  render?: ReactElement
  disabled?: boolean
  disabledReason?: string
  pending?: boolean
  destructive?: boolean
}

export function DataTableRowActions({
  label,
  actions,
}: {
  label: string
  actions: DataTableRowAction[]
}) {
  const { t } = useI18n()
  const visible = actions.slice(0, 3)
  const overflow = actions.slice(3)
  return (
    <div role="group" aria-label={label} className="flex items-center justify-end gap-1">
      {visible.map(({ id, label: actionLabel, icon: Icon, ...action }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant={action.destructive ? 'destructive' : 'accent'}
                aria-label={actionLabel}
                aria-busy={action.pending || undefined}
                disabled={action.disabled}
                focusableWhenDisabled
                nativeButton={action.render ? false : undefined}
                render={action.render}
                onClick={action.onClick}
              />
            }
          >
            {action.pending ? <Spinner /> : <Icon aria-hidden="true" />}
          </TooltipTrigger>
          <TooltipContent>
            {action.disabled && action.disabledReason ? action.disabledReason : actionLabel}
          </TooltipContent>
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button size="icon-sm" variant="accent" aria-label={t('table.moreActions')} />
                  }
                />
              }
            >
              <EllipsisIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t('table.moreActions')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {overflow.map(({ id, label: actionLabel, icon: Icon, ...action }) => (
                <DropdownMenuItem
                  key={id}
                  variant={action.destructive ? 'destructive' : 'default'}
                  disabled={action.disabled}
                  title={action.disabled ? action.disabledReason : undefined}
                  render={action.render}
                  onClick={action.onClick}
                >
                  {action.pending ? <Spinner /> : <Icon aria-hidden="true" />}
                  {actionLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
