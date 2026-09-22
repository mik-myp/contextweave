import { Badge } from '@/components/ui/badge'

export function KernelToolbar({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 pb-3">
      <Badge variant="secondary">{count} 个内核</Badge>
      <span className="text-xs text-muted-foreground">本机可用与已配置内核</span>
    </div>
  )
}
