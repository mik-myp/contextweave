import type { EnvironmentSummary } from '@contextweave/contracts'
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
import { Spinner } from '@/components/ui/spinner'

export function EnvironmentDeleteDialog({
  target,
  saving,
  onOpenChange,
  onRemove,
}: {
  target?: EnvironmentSummary
  saving: boolean
  onOpenChange: (open: boolean) => void
  onRemove: () => void
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除环境“{target?.name}”？</AlertDialogTitle>
          <AlertDialogDescription>
            只删除环境元数据，profile 目录和运行记录会保留，方便后续手动恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove} disabled={saving}>
            {saving && <Spinner />}
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
