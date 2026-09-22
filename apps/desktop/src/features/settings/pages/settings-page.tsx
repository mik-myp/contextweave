import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react'
import type {
  ThemeConfig,
  ThemeDensity,
  ThemeFont,
  ThemeMode,
  ThemePreset,
  ThemeRadius,
  SidebarLayout,
} from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/theme'
import { ThemeSelect } from '../components/theme-select'

export function SettingsPage() {
  const { appInfo, paths } = useAppData()
  const { theme, setTheme, resetTheme } = useTheme()
  const update = <K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) =>
    setTheme({ [key]: value } as Pick<ThemeConfig, K>)
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.45fr)]">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">外观</div>
            <div className="text-xs text-muted-foreground">调整颜色、密度和侧栏行为。</div>
          </div>
          <Button variant="outline" size="sm" onClick={resetTheme}>
            恢复默认
          </Button>
        </div>
        <div className="grid gap-x-6 gap-y-5 border-y border-border/60 py-5 sm:grid-cols-2">
          <ThemeSelect
            id="theme-mode"
            label="模式"
            value={theme.mode}
            options={[
              ['system', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ]}
            onChange={(value) => update('mode', value as ThemeMode)}
          />
          <ThemeSelect
            id="theme-preset"
            label="颜色预设"
            value={theme.preset}
            options={[
              ['signal-weave', '织境信号'],
              ['graphite', '石墨'],
              ['ocean', '深海'],
              ['amber', '琥珀'],
            ]}
            onChange={(value) => update('preset', value as ThemePreset)}
          />
          <ThemeSelect
            id="theme-radius"
            label="圆角"
            value={theme.radius}
            options={[
              ['none', '无圆角'],
              ['sm', '小'],
              ['md', '标准'],
              ['lg', '大'],
              ['xl', '特大'],
            ]}
            onChange={(value) => update('radius', value as ThemeRadius)}
          />
          <ThemeSelect
            id="theme-density"
            label="密度"
            value={theme.density}
            options={[
              ['compact', '紧凑'],
              ['comfortable', '舒适'],
              ['spacious', '宽松'],
            ]}
            onChange={(value) => update('density', value as ThemeDensity)}
          />
          <ThemeSelect
            id="theme-font"
            label="字体"
            value={theme.font}
            options={[
              ['geist', 'Geist'],
              ['system', '系统无衬线'],
              ['serif', '衬线'],
              ['mono', '等宽'],
            ]}
            onChange={(value) => update('font', value as ThemeFont)}
          />
          <ThemeSelect
            id="theme-sidebar-layout"
            label="侧栏布局"
            value={theme.sidebarLayout}
            options={[
              ['sidebar', '标准侧栏'],
              ['inset', '内嵌'],
              ['floating', '浮动'],
              ['offcanvas', '抽屉'],
            ]}
            onChange={(value) => update('sidebarLayout', value as SidebarLayout)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <div className="text-sm font-semibold">本地运行时</div>
          <div className="text-xs text-muted-foreground">用于确认当前设备和安全存储边界。</div>
        </div>
        <div className="flex flex-col gap-3 border-y border-border/60 py-5 text-sm">
          {appInfo && (
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">版本</span>
              <span>{appInfo.version}</span>
              <span className="text-muted-foreground">平台</span>
              <span>
                {appInfo.platform}/{appInfo.arch}
              </span>
              <span className="text-muted-foreground">安全存储</span>
              <span className="flex items-center gap-1">
                {appInfo.secureStorageAvailable ? (
                  <CheckCircle2Icon className="text-primary" />
                ) : (
                  <CircleAlertIcon className="text-destructive" />
                )}
                {appInfo.secureStorageAvailable ? '可用' : '不可用'}
              </span>
            </div>
          )}
          {paths && (
            <div className="flex flex-col gap-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <div className="truncate" title={paths.dataRoot}>
                数据目录：{paths.dataRoot}
              </div>
              <div className="truncate" title={paths.environmentRoot}>
                环境目录：{paths.environmentRoot}
              </div>
              <div className="truncate" title={paths.kernelRoot}>
                内核目录：{paths.kernelRoot}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
