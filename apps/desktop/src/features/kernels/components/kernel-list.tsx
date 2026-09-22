import { CheckCircle2Icon, CpuIcon, RocketIcon } from 'lucide-react'
import type { KernelSummary } from '@/shared/types/app'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function KernelList({
  kernels,
  onInstall,
}: {
  kernels: KernelSummary[]
  onInstall: (kernelId: string) => void
}) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/35">
      {kernels.map((kernel) => (
        <div
          key={kernel.id}
          className="flex flex-wrap items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/35"
        >
          <div className="flex min-w-56 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CpuIcon />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{kernel.label}</div>
              <div className="truncate text-xs text-muted-foreground">
                {kernel.id} · {kernel.version} · {kernel.platform}/{kernel.arch}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                kernel.status === 'available'
                  ? 'default'
                  : kernel.status === 'not-configured'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {kernel.status === 'available'
                ? '可用'
                : kernel.status === 'installed'
                  ? '已安装'
                  : '未配置'}
            </Badge>
            {kernel.packageAvailable ? (
              <Button size="sm" onClick={() => onInstall(kernel.id)}>
                <RocketIcon data-icon="inline-start" />
                安装/更新
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">来源和哈希待确认</span>
            )}
          </div>
          <div className="flex w-full flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            {Object.entries(kernel.capabilities).map(([key, value]) => (
              <span key={key} className="flex items-center gap-1">
                <CheckCircle2Icon className={value ? 'text-primary' : 'text-muted-foreground/40'} />
                {key}
              </span>
            ))}
          </div>
          {kernel.executablePath && (
            <div
              className="w-full truncate text-xs text-muted-foreground"
              title={kernel.executablePath}
            >
              {kernel.executablePath}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
