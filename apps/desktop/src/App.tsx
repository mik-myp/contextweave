import * as React from 'react'
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react'
import type {
  CreateEnvironmentInput,
  EnvironmentSummary,
  ProxyConfig,
  ProxyType,
  ThemeConfig,
  ThemeDensity,
  ThemeFont,
  ThemeMode,
  ThemePreset,
  ThemeRadius,
  SidebarLayout,
} from '@contextweave/contracts'
import { defaultCommonEnvironmentConfig, protocolVersion } from '@contextweave/contracts'
import { AppSidebar } from '@/components/app-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useTheme } from '@/theme'
import { TooltipProvider } from '@/components/ui/tooltip'

const pageByNav: Record<string, string> = {
  环境: 'environments',
  代理: 'proxies',
  内核: 'kernels',
  设置: 'settings',
  运行记录: 'activity',
  指纹策略: 'fingerprints',
}
const navByPage: Record<string, string> = Object.fromEntries(
  Object.entries(pageByNav).map(([key, value]) => [value, key]),
)

type KernelSummary = Extract<
  Awaited<ReturnType<typeof window.contextweave.kernel.list>>,
  { ok: true }
>['data'][number]
type ProxySummary = Extract<
  Awaited<ReturnType<typeof window.contextweave.proxy.list>>,
  { ok: true }
>['data'][number]

type Notice = { kind: 'success' | 'error'; message: string }

function statusLabel(status: EnvironmentSummary['status']): string {
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

function statusVariant(
  status: EnvironmentSummary['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'default'
  if (status === 'error' || status === 'needs-recovery') return 'destructive'
  if (status === 'created' || status === 'stopped') return 'secondary'
  return 'outline'
}

function App() {
  const { theme } = useTheme()
  const [page, setPage] = React.useState('environments')
  const [environments, setEnvironments] = React.useState<EnvironmentSummary[]>([])
  const [proxies, setProxies] = React.useState<ProxySummary[]>([])
  const [kernels, setKernels] = React.useState<KernelSummary[]>([])
  const [appInfo, setAppInfo] = React.useState<{
    name: string
    version: string
    platform: string
    arch: string
    secureStorageAvailable: boolean
  }>()
  const [paths, setPaths] = React.useState<{
    userData: string
    dataRoot: string
    environmentRoot: string
    kernelRoot: string
    logRoot: string
  }>()
  const [selectedEnvironment, setSelectedEnvironment] = React.useState<string>()
  const [notice, setNotice] = React.useState<Notice>()
  const [loading, setLoading] = React.useState(false)
  const [lastWorkerResult, setLastWorkerResult] = React.useState<string>()

  const refresh = React.useCallback(async () => {
    setLoading(true)
    const [environmentCall, proxyCall, kernelCall, infoCall, pathCall] = await Promise.allSettled([
      window.contextweave.environment.list(),
      window.contextweave.proxy.list(),
      window.contextweave.kernel.list(),
      window.contextweave.app.getInfo(),
      window.contextweave.app.getPaths(),
    ])
    const rejected = [environmentCall, proxyCall, kernelCall, infoCall, pathCall].find(
      (call) => call.status === 'rejected',
    )
    if (rejected?.status === 'rejected') {
      setNotice({
        kind: 'error',
        message: rejected.reason instanceof Error ? rejected.reason.message : '本地运行时读取失败',
      })
    }
    if (
      environmentCall.status !== 'fulfilled' ||
      proxyCall.status !== 'fulfilled' ||
      kernelCall.status !== 'fulfilled' ||
      infoCall.status !== 'fulfilled' ||
      pathCall.status !== 'fulfilled'
    ) {
      setLoading(false)
      return
    }
    const environmentResult = environmentCall.value
    const proxyResult = proxyCall.value
    const kernelResult = kernelCall.value
    const infoResult = infoCall.value
    const pathResult = pathCall.value
    const failed = [environmentResult, proxyResult, kernelResult, infoResult, pathResult].find(
      (result) => !result.ok,
    )
    if (failed && !failed.ok) setNotice({ kind: 'error', message: failed.message })
    if (environmentResult.ok) {
      setEnvironments(environmentResult.data)
      setSelectedEnvironment((current) =>
        current && environmentResult.data.some((item) => item.id === current)
          ? current
          : environmentResult.data[0]?.id,
      )
    }
    if (proxyResult.ok) setProxies([...proxyResult.data])
    if (kernelResult.ok) setKernels([...kernelResult.data])
    if (infoResult.ok) setAppInfo(infoResult.data)
    if (pathResult.ok) setPaths(pathResult.data)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])
  const selectPage = (title: string) => setPage(pageByNav[title] ?? 'environments')
  const perform = async (
    action: () => Promise<{ ok: true; data: EnvironmentSummary } | { ok: false; message: string }>,
    success: string,
  ) => {
    const result = await action()
    if (result.ok) {
      setNotice({ kind: 'success', message: success })
      await refresh()
    } else setNotice({ kind: 'error', message: result.message })
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          activeItem={navByPage[page] ?? '环境'}
          onSelect={selectPage}
          layout={theme.sidebarLayout}
        />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="truncate text-sm font-medium">ContextWeave</div>
              <span className="text-muted-foreground">/</span>
              <div className="truncate text-sm text-muted-foreground">
                {navByPage[page] ?? '环境'}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} aria-label="刷新">
              <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
            </Button>
          </header>
          <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4 md:p-6">
            {notice && (
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${notice.kind === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-primary/30 bg-primary/10'}`}
              >
                <span>{notice.message}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  onClick={() => setNotice(undefined)}
                >
                  ×
                </Button>
              </div>
            )}
            {page === 'environments' && (
              <EnvironmentPage
                environments={environments}
                proxies={proxies}
                kernels={kernels}
                selectedEnvironment={selectedEnvironment}
                onSelect={setSelectedEnvironment}
                onNotice={setNotice}
                onRefresh={refresh}
                onWorkerResult={(value) => {
                  setLastWorkerResult(value)
                  setPage('activity')
                }}
                perform={perform}
              />
            )}
            {page === 'proxies' && (
              <ProxyPage proxies={proxies} onNotice={setNotice} onRefresh={refresh} />
            )}
            {page === 'kernels' && (
              <KernelPage kernels={kernels} onNotice={setNotice} onRefresh={refresh} />
            )}
            {page === 'settings' && <SettingsPage appInfo={appInfo} paths={paths} />}
            {page === 'activity' && (
              <ActivityPage result={lastWorkerResult} environments={environments} />
            )}
            {page === 'fingerprints' && <FingerprintPage />}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

function EnvironmentPage({
  environments,
  proxies,
  kernels,
  selectedEnvironment,
  onSelect,
  onNotice,
  onRefresh,
  onWorkerResult,
  perform,
}: {
  environments: EnvironmentSummary[]
  proxies: ProxySummary[]
  kernels: KernelSummary[]
  selectedEnvironment?: string
  onSelect: (id: string) => void
  onNotice: (notice: Notice) => void
  onRefresh: () => Promise<void>
  onWorkerResult: (result: string) => void
  perform: (
    action: () => Promise<{ ok: true; data: EnvironmentSummary } | { ok: false; message: string }>,
    success: string,
  ) => Promise<void>
}) {
  const [name, setName] = React.useState('我的浏览环境')
  const [kernelId, setKernelId] = React.useState('standard-chromium')
  const [proxyId, setProxyId] = React.useState('')
  const selected = environments.find((item) => item.id === selectedEnvironment)
  const create = async () => {
    const input: CreateEnvironmentInput = {
      name,
      kernelId,
      proxyId: proxyId || undefined,
      commonConfig: defaultCommonEnvironmentConfig,
      kernelConfig: {},
    }
    const result = await window.contextweave.environment.create(input)
    if (result.ok) {
      onNotice({ kind: 'success', message: `环境“${result.data.name}”已创建` })
      setName('我的浏览环境')
      await onRefresh()
      onSelect(result.data.id)
    } else onNotice({ kind: 'error', message: result.message })
  }
  const start = () =>
    selected && perform(() => window.contextweave.environment.start(selected.id), '环境已启动')
  const stop = () =>
    selected && perform(() => window.contextweave.environment.stop(selected.id), '环境已停止')
  const recover = () =>
    selected && perform(() => window.contextweave.environment.recover(selected.id), '环境已恢复')
  const smoke = async () => {
    if (!selected || selected.status !== 'running') return
    const result = await window.contextweave.worker.runSmoke({
      protocolVersion,
      taskId: `smoke-${Date.now()}`,
      environmentId: selected.id,
      kind: 'browser-smoke',
      input: { url: 'https://example.com', timeoutMs: 30000 },
    })
    if (result.ok && result.data.ok)
      onWorkerResult(
        `成功读取页面标题：${result.data.title ?? '无标题'}${result.data.screenshotPath ? `；截图：${result.data.screenshotPath}` : ''}`,
      )
    else
      onNotice({
        kind: 'error',
        message: result.ok ? (result.data.errorMessage ?? 'Worker 执行失败') : result.message,
      })
  }
  return (
    <>
      <section className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">浏览环境</h1>
        <p className="text-sm text-muted-foreground">
          为每个工作流保留独立的浏览器用户目录、内核和代理配置。
        </p>
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>环境列表</CardTitle>
            <CardDescription>
              {environments.length
                ? `${environments.length} 个本地环境`
                : '还没有环境，先创建一个开始验证。'}
            </CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
                <RefreshCwIcon />
                刷新
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            {environments.length ? (
              environments.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${selectedEnvironment === item.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <GlobeIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.kernelId} · {item.platform}/{item.arch}
                    </div>
                  </div>
                  <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                没有环境记录
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>创建环境</CardTitle>
            <CardDescription>配置后将创建独立的本地用户目录。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="environment-name">名称</Label>
              <Input
                id="environment-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="environment-kernel">浏览器内核</Label>
              <NativeSelect
                className="w-full"
                id="environment-kernel"
                value={kernelId}
                onChange={(event) => setKernelId(event.target.value)}
              >
                {kernels.map((kernel) => (
                  <NativeSelectOption key={kernel.id} value={kernel.id}>
                    {kernel.label} · {kernel.version}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="environment-proxy">代理（可选）</Label>
              <NativeSelect
                className="w-full"
                id="environment-proxy"
                value={proxyId}
                onChange={(event) => setProxyId(event.target.value)}
              >
                <NativeSelectOption value="">不使用代理</NativeSelectOption>
                {proxies.map((proxy) => (
                  <NativeSelectOption key={proxy.proxyId} value={proxy.proxyId}>
                    {proxy.type.toUpperCase()} · {proxy.host}:{proxy.port}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={() => void create()} disabled={!name.trim()}>
              <PlusIcon />
              创建环境
            </Button>
          </CardFooter>
        </Card>
      </div>
      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>{selected.name}</CardTitle>
            <CardDescription>
              {selected.id} · 最近更新 {new Date(selected.updatedAt).toLocaleString()}
            </CardDescription>
            <CardAction>
              <Badge variant={statusVariant(selected.status)}>{statusLabel(selected.status)}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={() => void start()}
              disabled={
                selected.status === 'running' ||
                selected.status === 'starting' ||
                selected.status === 'stopping'
              }
            >
              <RocketIcon />
              启动
            </Button>
            <Button
              variant="outline"
              onClick={() => void stop()}
              disabled={selected.status !== 'running' && selected.status !== 'starting'}
            >
              <SquareIcon />
              停止
            </Button>
            <Button
              variant="outline"
              onClick={() => void recover()}
              disabled={selected.status !== 'needs-recovery'}
            >
              恢复运行锁
            </Button>
            <Button
              variant="secondary"
              onClick={() => void smoke()}
              disabled={selected.status !== 'running'}
            >
              <CheckCircle2Icon />
              Worker Smoke
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  )
}

function ProxyPage({
  proxies,
  onNotice,
  onRefresh,
}: {
  proxies: ProxySummary[]
  onNotice: (notice: Notice) => void
  onRefresh: () => Promise<void>
}) {
  const [editing, setEditing] = React.useState<string>()
  const [type, setType] = React.useState<ProxyType>('http')
  const [host, setHost] = React.useState('127.0.0.1')
  const [port, setPort] = React.useState('8080')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const save = async () => {
    const config: ProxyConfig = { type, host, port: Number(port), username: username || undefined }
    const result = await window.contextweave.proxy.save({
      proxyId: editing,
      config,
      password: password || undefined,
    })
    if (result.ok) {
      onNotice({ kind: 'success', message: '代理配置已保存，密码仅保存在系统安全存储中。' })
      setEditing(undefined)
      setPassword('')
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
  }
  const edit = (proxy: ProxySummary) => {
    setEditing(proxy.proxyId)
    setType(proxy.type as ProxyType)
    setHost(proxy.host)
    setPort(String(proxy.port))
    setUsername(proxy.username ?? '')
  }
  const remove = async (proxyId: string) => {
    const result = await window.contextweave.proxy.delete(proxyId)
    if (result.ok) {
      onNotice({ kind: 'success', message: '代理已删除' })
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
  }
  return (
    <>
      <section className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">代理管理</h1>
        <p className="text-sm text-muted-foreground">
          代理密码不进入 SQLite 或浏览器命令行，只通过受限的安全存储传递。
        </p>
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>已保存代理</CardTitle>
            <CardDescription>{proxies.length} 个配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {proxies.length ? (
              proxies.map((proxy) => (
                <div key={proxy.proxyId} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {proxy.type.toUpperCase()} · {proxy.host}:{proxy.port}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {proxy.username ? `用户 ${proxy.username}` : '无认证'}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => edit(proxy)}>
                    编辑
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="destructive"
                    onClick={() => void remove(proxy.proxyId)}
                    aria-label="删除代理"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                暂无代理
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{editing ? '编辑代理' : '添加代理'}</CardTitle>
            <CardDescription>HTTP、HTTPS 或 SOCKS5。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>类型</Label>
              <NativeSelect
                className="w-full"
                value={type}
                onChange={(event) => setType(event.target.value as ProxyType)}
              >
                <NativeSelectOption value="http">HTTP</NativeSelectOption>
                <NativeSelectOption value="https">HTTPS</NativeSelectOption>
                <NativeSelectOption value="socks5">SOCKS5</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <div className="space-y-2">
                <Label>主机</Label>
                <Input value={host} onChange={(event) => setHost(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>端口</Label>
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>用户名（可选）</Label>
              <Input value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>密码（可选）</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={editing ? '留空表示保持原密码' : ''}
              />
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button className="flex-1" onClick={() => void save()}>
              保存代理
            </Button>
            {editing && (
              <Button variant="outline" onClick={() => setEditing(undefined)}>
                取消
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </>
  )
}

function KernelPage({
  kernels,
  onNotice,
  onRefresh,
}: {
  kernels: KernelSummary[]
  onNotice: (notice: Notice) => void
  onRefresh: () => Promise<void>
}) {
  const install = async (kernelId: string) => {
    const result = await window.contextweave.kernel.install(kernelId)
    if (result.ok) {
      onNotice({ kind: 'success', message: '内核已安装并通过校验' })
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
  }
  return (
    <>
      <section className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">内核目录</h1>
        <p className="text-sm text-muted-foreground">
          所有内核都通过 manifest、平台架构和 SHA-256 校验后才允许执行。
        </p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {kernels.map((kernel) => (
          <Card key={kernel.id}>
            <CardHeader>
              <CardTitle>{kernel.label}</CardTitle>
              <CardDescription>
                {kernel.id} · {kernel.version} · {kernel.platform}/{kernel.arch}
              </CardDescription>
              <CardAction>
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
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                {Object.entries(kernel.capabilities).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-1">
                    <CheckCircle2Icon
                      className={value ? 'text-primary' : 'text-muted-foreground/40'}
                    />
                    {key}
                  </div>
                ))}
              </div>
              {kernel.executablePath && (
                <div
                  className="truncate text-xs text-muted-foreground"
                  title={kernel.executablePath}
                >
                  {kernel.executablePath}
                </div>
              )}
            </CardContent>
            <CardFooter>
              {kernel.packageAvailable ? (
                <Button onClick={() => void install(kernel.id)}>
                  <RocketIcon />
                  安装/更新
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">等待已确认的内核来源和哈希</span>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  )
}

function SettingsPage({
  appInfo,
  paths,
}: {
  appInfo?: {
    name: string
    version: string
    platform: string
    arch: string
    secureStorageAvailable: boolean
  }
  paths?: {
    userData: string
    dataRoot: string
    environmentRoot: string
    kernelRoot: string
    logRoot: string
  }
}) {
  const { theme, setTheme, resetTheme } = useTheme()
  const update = <K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) =>
    setTheme({ [key]: value } as Pick<ThemeConfig, K>)
  return (
    <>
      <section className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground">
          主题偏好会版本化存储在本地 SQLite，通过受限 Preload API 恢复。
        </p>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>主题</CardTitle>
            <CardDescription>预览会即时应用，重启后自动恢复。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ThemeSelect
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
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={resetTheme}>
              恢复默认主题
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>本地运行时</CardTitle>
            <CardDescription>诊断信息用于确认 v0.1 环境边界。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
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
              <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
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
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ThemeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <NativeSelect
        className="w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <NativeSelectOption key={optionValue} value={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

function ActivityPage({
  result,
  environments,
}: {
  result?: string
  environments: EnvironmentSummary[]
}) {
  return (
    <>
      <section className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">运行记录</h1>
        <p className="text-sm text-muted-foreground">
          Worker、启动和恢复事件会在后续版本接入完整审计视图。
        </p>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>最近一次 Worker Smoke</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="rounded-lg bg-muted p-4 text-sm">{result}</div>
          ) : (
            <div className="text-sm text-muted-foreground">
              在环境页面启动一个环境并运行 Worker Smoke 后，这里会显示结果。
            </div>
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          当前环境数量：{environments.length}
        </CardFooter>
      </Card>
    </>
  )
}
function FingerprintPage() {
  return (
    <>
      <section className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">指纹策略</h1>
        <p className="text-sm text-muted-foreground">
          v0.1 只提供经过 manifest 和 adapter 约束的最小环境配置。
        </p>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>策略边界</CardTitle>
          <CardDescription>浏览器内核参数不会散落在页面代码中。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>每个环境记录语言、时区、窗口、WebRTC 和代理策略，并由 Kernel Adapter 在启动前校验。</p>
          <p>
            fingerprint-chromium 当前仅注册适配器和参数 schema，待确认可分发来源、许可证和 SHA-256
            后再启用安装。
          </p>
        </CardContent>
      </Card>
    </>
  )
}

export default App
