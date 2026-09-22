import { useAppData } from '@/app/use-app-data'
import { Badge } from '@/components/ui/badge'

export function ActivityPage() {
  const { lastWorkerResult: result, environments } = useAppData()
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 pb-3">
        <Badge variant="secondary">最近一次 Worker Smoke</Badge>
        <span className="text-xs text-muted-foreground">当前环境数量：{environments.length}</span>
      </div>
      <div className="border-y border-border/60 py-5">
        {result ? (
          <div className="rounded-lg bg-muted p-4 text-sm">{result}</div>
        ) : (
          <div className="text-sm text-muted-foreground">
            在环境页面启动一个环境并运行 Worker Smoke 后，这里会显示结果。
          </div>
        )}
      </div>
    </div>
  )
}
