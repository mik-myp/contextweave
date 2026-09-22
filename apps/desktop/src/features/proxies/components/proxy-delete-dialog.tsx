import type { ProxySummary } from '@/shared/types/app'
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

export function ProxyDeleteDialog({
  target,
  saving,
  onOpenChange,
  onRemove,
}: {
  target?: ProxySummary
  saving: boolean
  onOpenChange: (open: boolean) => void
  onRemove: () => void
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            删除代理“{target?.host}:{target?.port}”？
          </AlertDialogTitle>
          <AlertDialogDescription>
            如果仍有环境绑定此代理，删除会被拒绝。删除后不会影响已保留的环境目录。
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
