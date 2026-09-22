import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EnvironmentSummary } from '@contextweave/contracts'

export function EnvironmentRowActions({
  item,
  canManage,
  onEdit,
  onDelete,
}: {
  item: EnvironmentSummary
  canManage: (item: EnvironmentSummary) => boolean
  onEdit: (item: EnvironmentSummary) => void
  onDelete: (item: EnvironmentSummary) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(event) => event.stopPropagation()}
            aria-label={'打开' + item.name + '的操作菜单'}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!canManage(item)} onClick={() => onEdit(item)}>
            <PencilIcon />
            编辑
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={!canManage(item)}
            onClick={() => onDelete(item)}
          >
            <Trash2Icon />
            删除
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
