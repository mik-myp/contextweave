import { GlobeIcon } from 'lucide-react'
import { useAppData } from '@/app/use-app-data'

export function AboutPage() {
  const { appInfo } = useAppData()
  return (
    <div className="max-w-2xl">
      <div className="flex flex-col gap-5 border-y border-border/60 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GlobeIcon />
          </div>
          <div className="min-w-0">
            <div className="font-heading text-lg font-semibold">
              {appInfo?.name ?? 'ContextWeave'}
            </div>
            <div className="text-sm text-muted-foreground">
              面向授权场景的多内核浏览器环境管理工具。
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-y border-border/60 py-4 text-sm">
          <span className="text-muted-foreground">版本</span>
          <span>{appInfo?.version ?? '开发版本'}</span>
          <span className="text-muted-foreground">平台</span>
          <span>{appInfo ? appInfo.platform + '/' + appInfo.arch : '本地桌面端'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          v0.1 仅提供个人本地环境、代理、内核和运行验证能力。
        </p>
      </div>
    </div>
  )
}
