import type { EnvironmentSummary } from '@contextweave/contracts'

export function statusLabel(status: EnvironmentSummary['status']): string {
  return (
    {
      created: '已创建',
      ready: '就绪',
      starting: '启动中',
      running: '运行中',
      stopping: '停止中',
      stopped: '已停止',
      error: '错误',
      'needs-recovery': '需恢复',
    } as Record<EnvironmentSummary['status'], string>
  )[status]
}

export function statusVariant(
  status: EnvironmentSummary['status'],
): 'success' | 'warning' | 'info' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'success'
  if (status === 'starting' || status === 'stopping') return 'info'
  if (status === 'needs-recovery') return 'warning'
  if (status === 'error') return 'destructive'
  if (status === 'created' || status === 'stopped') return 'secondary'
  return 'outline'
}
