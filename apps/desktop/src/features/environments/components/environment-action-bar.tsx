import { CheckCircle2Icon, GlobeIcon, RocketIcon, SquareIcon } from 'lucide-react'
import type { EnvironmentSummary } from '@contextweave/contracts'
import type { ProxySummary } from '@/shared/types/app'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { statusLabel, statusVariant } from '@/shared/lib/environment'

export function EnvironmentActionBar({
  selected,
  proxies,
  onStart,
  onStop,
  onRecover,
  onSmoke,
}: {
  selected: EnvironmentSummary
  proxies: ProxySummary[]
  onStart: () => void
  onStop: () => void
  onRecover: () => void
  onSmoke: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <GlobeIcon />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate font-medium">{selected.name}</div>
            <Badge variant={statusVariant(selected.status)}>{statusLabel(selected.status)}</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {selected.kernelId} · {selected.kernelVersion} ·{' '}
            {selected.proxyId
              ? (proxies.find((proxy) => proxy.proxyId === selected.proxyId)?.host ?? '已绑定代理')
              : '未使用代理'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={onStart}
          disabled={
            selected.status === 'running' ||
            selected.status === 'starting' ||
            selected.status === 'stopping'
          }
        >
          <RocketIcon data-icon="inline-start" />
          启动
        </Button>
        <Button
          variant="outline"
          onClick={onStop}
          disabled={selected.status !== 'running' && selected.status !== 'starting'}
        >
          <SquareIcon data-icon="inline-start" />
          停止
        </Button>
        <Button
          variant="outline"
          onClick={onRecover}
          disabled={selected.status !== 'needs-recovery'}
        >
          恢复运行锁
        </Button>
        <Button variant="secondary" onClick={onSmoke} disabled={selected.status !== 'running'}>
          <CheckCircle2Icon data-icon="inline-start" />
          Worker Smoke
        </Button>
      </div>
    </div>
  )
}
