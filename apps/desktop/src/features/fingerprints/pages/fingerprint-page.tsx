import { Badge } from '@/components/ui/badge'

export function FingerprintPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <Badge variant="secondary">策略边界</Badge>
        <span className="text-xs text-muted-foreground">配置由 Kernel Adapter 在启动前校验</span>
      </div>
      <div className="divide-y divide-border/60 border-y border-border/60">
        <div className="flex flex-col gap-1 py-4 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="font-medium">环境配置</div>
          <p className="max-w-xl text-muted-foreground">
            每个环境记录语言、时区、窗口、WebRTC 和代理策略。
          </p>
        </div>
        <div className="flex flex-col gap-1 py-4 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="font-medium">fingerprint-chromium</div>
          <p className="max-w-xl text-muted-foreground">
            当前仅注册适配器和参数 schema，待确认可分发来源、许可证和 SHA-256 后再启用安装。
          </p>
        </div>
      </div>
    </div>
  )
}
