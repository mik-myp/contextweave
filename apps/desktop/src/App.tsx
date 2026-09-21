import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudDownload,
  Command,
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe2,
  HardDrive,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import './App.css'


type View = 'environments' | 'proxies' | 'kernels' | 'settings'
type Environment = {
  id: string
  name: string
  status: string
  kernelId: string
  kernelVersion: string
  platform: string
  arch: string
  updatedAt: string
}
type Kernel = {
  id: string
  label: string
  family: string
  platform: string
  arch: string
  version: string
  status: string
  executablePath?: string
  installationPath?: string
  packageAvailable: boolean
  capabilities: Record<string, boolean>
}
type Proxy = {
  proxyId: string
  type: string
  host: string
  port: number
  username?: string
  credentialRef?: string
  createdAt: string
  updatedAt: string
}
type Notice = { kind: 'success' | 'error' | 'info'; title: string; message: string }
type CreateFormValues = { name: string; kernelId: string; proxyId?: string; language: string; timezone: string }

const navItems: Array<{ id: View; label: string; hint: string; icon: typeof Boxes }> = [
  { id: 'environments', label: '浏览器环境', hint: '隔离的本地工作区', icon: Boxes },
  { id: 'proxies', label: '代理管理', hint: '连接方式与出口', icon: Network },
  { id: 'kernels', label: '内核目录', hint: '版本与能力检查', icon: Cpu },
  { id: 'settings', label: '设置', hint: '路径、存储与诊断', icon: Settings2 },
]

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: '待配置',
    ready: '可启动',
    starting: '启动中',
    running: '运行中',
    stopping: '停止中',
    stopped: '已停止',
    error: '需要处理',
    'needs-recovery': '需要恢复',
  }
  return labels[status] ?? status
}

function App() {
  const [view, setView] = useState<View>('environments')
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [kernels, setKernels] = useState<Kernel[]>([])
  const [paths, setPaths] = useState<{ dataRoot: string; environmentRoot: string; kernelRoot: string; logRoot: string }>()
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [proxyDraft, setProxyDraft] = useState({ type: 'http', host: '', port: '8080', username: '', password: '' })
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [busyEnvironmentId, setBusyEnvironmentId] = useState<string>()
  const [smokeUrl, setSmokeUrl] = useState('https://example.com')
  const [notice, setNotice] = useState<Notice>()
  const [info, setInfo] = useState<{ version: string; platform: string; arch: string; secureStorageAvailable: boolean }>()
  const form = useForm<CreateFormValues>({
    defaultValues: { name: '', kernelId: 'standard-chromium', proxyId: undefined, language: 'zh-CN', timezone: 'Asia/Shanghai' },
  })

  const selectedEnvironment = environments.find((environment) => environment.id === selectedEnvironmentId)
  const availableKernels = useMemo(() => kernels.filter((kernel) => kernel.platform === info?.platform && kernel.arch === info?.arch), [info?.arch, info?.platform, kernels])
  const runningCount = environments.filter((environment) => environment.status === 'running').length

  async function refresh() {
    setIsRefreshing(true)
    const [environmentResult, kernelResult, pathResult, infoResult, proxyResult] = await Promise.all([
      window.contextweave.environment.list(),
      window.contextweave.kernel.list(),
      window.contextweave.app.getPaths(),
      window.contextweave.app.getInfo(),
      window.contextweave.proxy.list(),
    ])
    if (environmentResult.ok) {
      setEnvironments(environmentResult.data)
      setSelectedEnvironmentId((current) => current ?? environmentResult.data[0]?.id)
    } else {
      setNotice({ kind: 'error', title: '无法读取环境', message: environmentResult.message })
    }
    if (kernelResult.ok) setKernels([...kernelResult.data])
    if (pathResult.ok) setPaths(pathResult.data)
    if (infoResult.ok) setInfo(infoResult.data)
    if (proxyResult.ok) setProxies([...proxyResult.data])
    setIsRefreshing(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function createEnvironment(values: CreateFormValues) {
    const result = await window.contextweave.environment.create({
      name: values.name,
      kernelId: values.kernelId,
      proxyId: values.proxyId || undefined,
      commonConfig: {
        language: values.language,
        timezone: values.timezone,
        window: { width: 1440, height: 900 },
        hardwareConcurrency: 8,
        webRtcPolicy: 'proxy',
        dnsPolicy: 'proxy',
      },
      kernelConfig: {},
    })
    if (!result.ok) {
      setNotice({ kind: 'error', title: '环境创建失败', message: result.message })
      return
    }
    setEnvironments((current) => [result.data, ...current])
    setSelectedEnvironmentId(result.data.id)
    setIsCreateOpen(false)
    form.reset()
    setNotice({ kind: 'success', title: '环境已创建', message: `${result.data.name} 已加入个人空间。` })
  }

  async function saveProxy() {
    const port = Number(proxyDraft.port)
    const result = await window.contextweave.proxy.save({
      config: {
        type: proxyDraft.type as 'http' | 'https' | 'socks5',
        host: proxyDraft.host,
        port,
        username: proxyDraft.username || undefined,
      },
      password: proxyDraft.password || undefined,
    })
    if (!result.ok) {
      setNotice({ kind: 'error', title: '代理保存失败', message: result.message })
      return
    }
    setProxies((current) => [result.data, ...current.filter((item) => item.proxyId !== result.data.proxyId)])
    setProxyDraft({ type: 'http', host: '', port: '8080', username: '', password: '' })
    setNotice({ kind: 'success', title: '代理已保存', message: `${result.data.type}://${result.data.host}:${result.data.port}` })
  }

  async function removeProxy(proxy: Proxy) {
    const result = await window.contextweave.proxy.delete(proxy.proxyId)
    if (!result.ok) {
      setNotice({ kind: 'error', title: '代理删除失败', message: result.message })
      return
    }
    setProxies((current) => current.filter((item) => item.proxyId !== proxy.proxyId))
    setNotice({ kind: 'success', title: '代理已删除', message: `${proxy.host}:${proxy.port}` })
  }

  async function installKernel(kernel: Kernel) {
    setNotice({ kind: 'info', title: '正在安装内核', message: kernel.label })
    const result = await window.contextweave.kernel.install(kernel.id)
    if (!result.ok) {
      setNotice({ kind: 'error', title: '内核安装失败', message: result.message })
      return
    }
    setKernels((current) => current.map((item) => item.id === result.data.id ? result.data : item))
    setNotice({ kind: 'success', title: '内核已安装', message: result.data.label })
  }

  async function toggleEnvironment(environment: Environment) {
    setBusyEnvironmentId(environment.id)
    const result = environment.status === 'running'
      ? await window.contextweave.environment.stop(environment.id)
      : await window.contextweave.environment.start(environment.id)
    setBusyEnvironmentId(undefined)
    if (result.ok) {
      setEnvironments((current) => current.map((item) => item.id === result.data.id ? result.data : item))
      setNotice({ kind: 'success', title: environment.status === 'running' ? '环境已停止' : '环境已启动', message: result.data.name })
    } else {
      setNotice({ kind: 'error', title: environment.status === 'running' ? '停止失败' : '启动失败', message: result.message })
      await refresh()
    }
  }

  async function recoverEnvironment(environment: Environment) {
    setBusyEnvironmentId(environment.id)
    const result = await window.contextweave.environment.recover(environment.id)
    setBusyEnvironmentId(undefined)
    if (result.ok) {
      setEnvironments((current) => current.map((item) => item.id === result.data.id ? result.data : item))
      setNotice({ kind: 'success', title: '环境已恢复', message: result.data.name })
    } else {
      setNotice({ kind: 'error', title: '恢复失败', message: result.message })
    }
  }

  async function runSmoke() {
    if (!selectedEnvironment || selectedEnvironment.status !== 'running') return
    const result = await window.contextweave.worker.runSmoke({
      protocolVersion: 1,
      taskId: `task-${Date.now()}`,
      environmentId: selectedEnvironment.id,
      kind: 'browser-smoke',
      input: { url: smokeUrl, timeoutMs: 30000 },
    })
    if (result.ok && result.data.ok) {
      setNotice({ kind: 'success', title: 'Worker 检查完成', message: `页面标题：${result.data.title ?? '未读取'}` })
    } else {
      setNotice({ kind: 'error', title: 'Worker 检查失败', message: result.ok ? (result.data.errorMessage ?? '页面操作失败') : result.message })
    }
  }

  return (
    <TooltipProvider>
      <div className="app-shell">
        <aside className="sidebar-panel">
          <div className="sidebar-topline" />
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
            <div>
              <div className="brand-name">contextweave</div>
              <div className="brand-caption">personal browser workspace</div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="workspace-switcher">
                <span className="workspace-icon"><UserRound data-icon="inline-start" /></span>
                <span className="workspace-copy"><strong>个人空间</strong><small>本地工作区</small></span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="workspace-menu">
              <DropdownMenuLabel>切换工作空间</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem><Check data-icon="inline-start" />个人空间<Badge variant="secondary" className="ml-auto">当前</Badge></DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled><Plus data-icon="inline-start" />创建团队（v0.4）</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="sidebar-section-label">工作台</div>
          <nav className="sidebar-nav" aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <button key={item.id} type="button" className={`nav-item ${view === item.id ? 'is-active' : ''}`} onClick={() => setView(item.id)}>
                  <Icon className="nav-icon" aria-hidden="true" />
                  <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                  {item.id === 'environments' && runningCount > 0 ? <Badge variant="secondary">{runningCount}</Badge> : null}
                </button>
              )
            })}
          </nav>

          <div className="sidebar-spacer" />
          <div className="sidebar-footnote">
            <ShieldCheck data-icon="inline-start" />
            <span>本地优先<br /><small>数据留在这台设备</small></span>
          </div>
          <Separator className="sidebar-separator" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="user-menu-trigger">
                <Avatar size="sm"><AvatarFallback>ME</AvatarFallback></Avatar>
                <span><strong>本地用户</strong><small>个人模式</small></span>
                <MoreHorizontal className="ml-auto" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="user-menu">
              <DropdownMenuLabel>本地用户</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setView('settings')}><Settings2 data-icon="inline-start" />设置</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void window.contextweave.app.openExternal('https://github.com/mik-myp/contextweave')}><ExternalLink data-icon="inline-start" />项目主页</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled><CircleHelp data-icon="inline-start" />关于 ContextWeave</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </aside>

        <main className="main-panel">
          <header className="topbar">
            <div className="breadcrumb"><span>个人空间</span><span className="breadcrumb-divider">/</span><strong>{navItems.find((item) => item.id === view)?.label}</strong></div>
            <div className="topbar-actions">
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={isRefreshing} aria-label="刷新数据"><RefreshCw className={isRefreshing ? 'spin' : ''} /></Button></TooltipTrigger><TooltipContent>刷新本地状态</TooltipContent></Tooltip>
              <div className="runtime-pill"><span className="status-dot" /><span>Local runtime</span><small>{info?.platform ?? '—'} · {info?.arch ?? '—'}</small></div>
              <Button variant="outline" size="sm" onClick={() => void window.contextweave.app.openExternal('https://github.com/mik-myp/contextweave')}><Command data-icon="inline-start" />项目文档</Button>
            </div>
          </header>

          <ScrollArea className="content-scroll">
            <div className="content-wrap">
              {notice ? (
                <Alert className={`notice notice-${notice.kind}`}>
                  {notice.kind === 'success' ? <Check /> : notice.kind === 'error' ? <X /> : <Activity />}
                  <div><AlertTitle>{notice.title}</AlertTitle><AlertDescription>{notice.message}</AlertDescription></div>
                  <Button variant="ghost" size="icon-xs" className="notice-close" onClick={() => setNotice(undefined)} aria-label="关闭提示"><X /></Button>
                </Alert>
              ) : null}

              {view === 'environments' ? (
                <>
                  <section className="page-heading">
                    <div><div className="eyebrow"><span className="eyebrow-line" />个人工作台</div><h1>浏览器环境</h1><p>每个环境都有独立的用户目录、内核和连接方式。</p></div>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                      <DialogTrigger asChild><Button size="lg" className="primary-action"><Plus data-icon="inline-start" />创建环境</Button></DialogTrigger>
                      <DialogContent className="create-dialog">
                        <DialogHeader><DialogTitle>创建个人环境</DialogTitle><DialogDescription>先创建一个本地环境，之后可以配置代理和内核专属参数。</DialogDescription></DialogHeader>
                        <form className="create-form" onSubmit={form.handleSubmit(createEnvironment)}>
                          <FieldGroup>
                            <Field>
                              <FieldLabel htmlFor="environment-name">环境名称</FieldLabel>
                              <Input id="environment-name" placeholder="例如：美国店铺运营" {...form.register('name', { required: '请输入环境名称' })} />
                              {form.formState.errors.name ? <FieldDescription className="field-error">{form.formState.errors.name.message}</FieldDescription> : null}
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="environment-kernel">浏览器内核</FieldLabel>
                              <Select value={form.watch('kernelId')} onValueChange={(value) => form.setValue('kernelId', value)}>
                                <SelectTrigger id="environment-kernel"><SelectValue placeholder="选择内核" /></SelectTrigger>
                                <SelectContent><SelectGroup>{availableKernels.map((kernel) => <SelectItem key={kernel.id} value={kernel.id}>{kernel.label} · {kernel.status === 'available' ? '可用' : '待配置'}</SelectItem>)}</SelectGroup></SelectContent>
                              </Select>
                              <FieldDescription>v0.1 先验证两个 Chromium 系内核。</FieldDescription>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="environment-proxy">代理</FieldLabel>
                              <Select value={form.watch('proxyId') ?? 'none'} onValueChange={(value) => form.setValue('proxyId', value === 'none' ? undefined : value)}>
                                <SelectTrigger id="environment-proxy"><SelectValue placeholder="不使用代理" /></SelectTrigger>
                                <SelectContent><SelectGroup>
                                  <SelectItem value="none">不使用代理</SelectItem>
                                  {proxies.map((proxy) => <SelectItem key={proxy.proxyId} value={proxy.proxyId}>{proxy.type}://{proxy.host}:{proxy.port}</SelectItem>)}
                                </SelectGroup></SelectContent>
                              </Select>
                              <FieldDescription>{proxies.length > 0 ? '代理凭据只保存在系统安全存储。' : '可在代理管理中先保存一个代理。'}</FieldDescription>
                            </Field>
                            <div className="form-two-col">
                              <Field><FieldLabel htmlFor="environment-language">语言</FieldLabel><Input id="environment-language" {...form.register('language')} /></Field>
                              <Field><FieldLabel htmlFor="environment-timezone">时区</FieldLabel><Input id="environment-timezone" {...form.register('timezone')} /></Field>
                            </div>
                          </FieldGroup>
                          <DialogFooter><Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>取消</Button><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}创建环境</Button></DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </section>

                  <section className="signal-grid" aria-label="本地状态概览">
                    <Card className="signal-card signal-card-primary"><CardContent><div className="signal-icon"><LayoutGrid /></div><div><span>环境总数</span><strong>{environments.length.toString().padStart(2, '0')}</strong></div><small>本地隔离工作区</small></CardContent></Card>
                    <Card className="signal-card"><CardContent><div className="signal-icon signal-icon-blue"><Globe2 /></div><div><span>正在运行</span><strong>{runningCount.toString().padStart(2, '0')}</strong></div><small>外部浏览器进程</small></CardContent></Card>
                    <Card className="signal-card"><CardContent><div className="signal-icon signal-icon-amber"><Cpu /></div><div><span>已注册内核</span><strong>{kernels.length.toString().padStart(2, '0')}</strong></div><small>当前平台可识别</small></CardContent></Card>
                    <Card className="signal-card"><CardContent><div className="signal-icon signal-icon-green"><LockKeyhole /></div><div><span>本地存储</span><strong>{info?.secureStorageAvailable ? 'OK' : '—'}</strong></div><small>{info?.secureStorageAvailable ? '系统安全存储可用' : '等待系统信息'}</small></CardContent></Card>
                  </section>

                  <section className="workspace-panel">
                    <div className="section-heading"><div><h2>我的环境</h2><p>选择一个环境开始浏览或运行最小 Worker 检查。</p></div><div className="section-actions"><Badge variant="outline"><HardDrive data-icon="inline-start" />个人本地</Badge><Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(true)}><Plus data-icon="inline-start" />新建</Button></div></div>
                    {environments.length === 0 ? (
                      <Card className="empty-card"><CardContent><div className="empty-orbit"><span /><span /><span /></div><h3>还没有浏览器环境</h3><p>创建第一个隔离环境，把网站访问和本地配置分开。</p><Button onClick={() => setIsCreateOpen(true)}><Plus data-icon="inline-start" />创建第一个环境</Button></CardContent></Card>
                    ) : (
                      <div className="environment-grid">
                        {environments.map((environment) => {
                          const kernel = kernels.find((item) => item.id === environment.kernelId)
                          const isSelected = selectedEnvironmentId === environment.id
                          const isBusy = busyEnvironmentId === environment.id
                          return <Card key={environment.id} className={`environment-card ${isSelected ? 'is-selected' : ''}`} onClick={() => setSelectedEnvironmentId(environment.id)}>
                            <CardHeader><div className="card-topline"><Badge variant={environment.status === 'running' ? 'default' : environment.status === 'error' ? 'destructive' : 'secondary'}><span className={`mini-dot status-${environment.status}`} />{statusLabel(environment.status)}</Badge><Button variant="ghost" size="icon-xs" aria-label="更多操作"><MoreHorizontal /></Button></div><CardTitle>{environment.name}</CardTitle><CardDescription>{kernel?.label ?? environment.kernelId} · {environment.kernelVersion}</CardDescription></CardHeader>
                            <CardContent><div className="environment-meta"><span><FolderOpen />独立目录</span><span><Clock3 />更新于 {formatTime(environment.updatedAt)}</span></div><div className="environment-signal"><span className="signal-track"><span style={{ width: environment.status === 'running' ? '76%' : '24%' }} /></span><small>{environment.status === 'running' ? '控制端口已连接' : '等待启动'}</small></div></CardContent>
                            <CardFooter>
                              <Button
                                variant={environment.status === 'running' ? 'outline' : 'default'}
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void (environment.status === 'needs-recovery' ? recoverEnvironment(environment) : toggleEnvironment(environment))
                                }}
                                disabled={isBusy || environment.status === 'starting' || environment.status === 'stopping'}
                              >
                                {isBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : environment.status === 'running' ? <Square data-icon="inline-start" /> : environment.status === 'needs-recovery' ? <RefreshCw data-icon="inline-start" /> : <ArrowUpRight data-icon="inline-start" />}
                                {isBusy ? '处理中' : environment.status === 'running' ? '停止环境' : environment.status === 'needs-recovery' ? '恢复环境' : '启动环境'}
                              </Button>
                              <span className="card-footnote">{environment.platform} · {environment.arch}</span>
                            </CardFooter>
                          </Card>
                        })}
                      </div>
                    )}
                  </section>

                  {selectedEnvironment ? <section className="smoke-panel"><div className="smoke-copy"><div className="eyebrow"><span className="eyebrow-line" />Worker smoke check</div><h2>验证浏览器控制链路</h2><p>环境运行后，Worker 会打开页面、读取标题并保存截图。</p></div><div className="smoke-action"><div className="smoke-input"><Label htmlFor="smoke-url">测试地址</Label><Input id="smoke-url" value={smokeUrl} onChange={(event) => setSmokeUrl(event.target.value)} /></div><Button variant="secondary" onClick={() => void runSmoke()} disabled={selectedEnvironment.status !== 'running'}><TerminalSquare data-icon="inline-start" />运行检查</Button></div></section> : null}
                </>
              ) : null}

              {view === 'proxies' ? (
                <section className="simple-page">
                  <div className="page-heading">
                    <div><div className="eyebrow"><span className="eyebrow-line" />连接配置</div><h1>代理管理</h1><p>每个环境可绑定一个 HTTP、HTTPS 或 SOCKS5 代理。</p></div>
                  </div>
                  <div className="settings-grid">
                    <Card>
                      <CardHeader><CardTitle><Network data-icon="inline-start" />保存代理</CardTitle><CardDescription>密码通过系统安全存储保存，不写入 SQLite。</CardDescription></CardHeader>
                      <CardContent className="proxy-form">
                        <div className="form-two-col">
                          <Field><FieldLabel htmlFor="proxy-type">协议</FieldLabel><Select value={proxyDraft.type} onValueChange={(value) => setProxyDraft((current) => ({ ...current, type: value }))}><SelectTrigger id="proxy-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="http">HTTP</SelectItem><SelectItem value="https">HTTPS</SelectItem><SelectItem value="socks5">SOCKS5</SelectItem></SelectContent></Select></Field>
                          <Field><FieldLabel htmlFor="proxy-port">端口</FieldLabel><Input id="proxy-port" type="number" min={1} max={65535} value={proxyDraft.port} onChange={(event) => setProxyDraft((current) => ({ ...current, port: event.target.value }))} /></Field>
                        </div>
                        <Field><FieldLabel htmlFor="proxy-host">主机</FieldLabel><Input id="proxy-host" placeholder="proxy.example.com" value={proxyDraft.host} onChange={(event) => setProxyDraft((current) => ({ ...current, host: event.target.value }))} /></Field>
                        <div className="form-two-col">
                          <Field><FieldLabel htmlFor="proxy-username">用户名（可选）</FieldLabel><Input id="proxy-username" value={proxyDraft.username} onChange={(event) => setProxyDraft((current) => ({ ...current, username: event.target.value }))} /></Field>
                          <Field><FieldLabel htmlFor="proxy-password">密码（可选）</FieldLabel><Input id="proxy-password" type="password" value={proxyDraft.password} onChange={(event) => setProxyDraft((current) => ({ ...current, password: event.target.value }))} /></Field>
                        </div>
                        <Button onClick={() => void saveProxy()} disabled={!proxyDraft.host || !proxyDraft.port}><Plus data-icon="inline-start" />保存代理</Button>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>已保存代理</CardTitle><CardDescription>{proxies.length > 0 ? `${proxies.length} 个本地代理配置` : '还没有保存代理。'}</CardDescription></CardHeader>
                      <CardContent className="path-list">
                        {proxies.length > 0 ? proxies.map((proxy) => (
                          <div key={proxy.proxyId} className="proxy-row"><span><strong>{proxy.type}://{proxy.host}:{proxy.port}</strong><small>{proxy.username ? `用户：${proxy.username}` : '无认证用户'}{proxy.credentialRef ? ' · 密码已加密' : ''}</small></span><Button variant="ghost" size="icon-sm" onClick={() => void removeProxy(proxy)} aria-label={`删除 ${proxy.host}`}><Trash2 /></Button></div>
                        )) : <p>先在左侧保存一个代理，创建环境时即可选择。</p>}
                      </CardContent>
                    </Card>
                  </div>
                </section>
              ) : null}
              {view === 'kernels' ? <section className="simple-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />运行时目录</div><h1>浏览器内核</h1><p>每个内核都有自己的 manifest、能力和配置边界。</p></div></div><div className="kernel-list">{kernels.map((kernel) => <Card key={kernel.id} className="kernel-card"><CardContent><div className="kernel-icon"><Cpu /></div><div className="kernel-info"><div className="kernel-name-row"><h3>{kernel.label}</h3><Badge variant={kernel.status === 'available' ? 'default' : 'secondary'}>{kernel.status === 'available' ? '可用' : kernel.status === 'not-installed' ? '未安装' : '待配置'}</Badge></div><p>{kernel.id} · {kernel.version}</p><div className="capability-row">{Object.entries(kernel.capabilities).filter(([, supported]) => supported).slice(0, 5).map(([capability]) => <Badge key={capability} variant="outline">{capability}</Badge>)}</div></div><Button variant="outline" size="sm" disabled={!kernel.packageAvailable} onClick={() => void installKernel(kernel)}><CloudDownload data-icon="inline-start" />{kernel.packageAvailable ? '安装内核' : kernel.status === 'available' ? '本机可用' : '等待 manifest'}</Button></CardContent></Card>)}</div></section> : null}
              {view === 'settings' ? <section className="simple-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />本地偏好</div><h1>设置</h1><p>备份、同步和维护类入口统一放在设置中。</p></div></div><div className="settings-grid"><Card><CardHeader><CardTitle><HardDrive data-icon="inline-start" />数据与存储</CardTitle><CardDescription>当前客户端使用本地 SQLite 保存环境元数据。</CardDescription></CardHeader><CardContent className="path-list">{paths ? <><div><span>数据目录</span><code>{paths.dataRoot}</code></div><div><span>环境目录</span><code>{paths.environmentRoot}</code></div><div><span>内核目录</span><code>{paths.kernelRoot}</code></div><div><span>日志目录</span><code>{paths.logRoot}</code></div></> : <p>正在读取路径信息。</p>}</CardContent></Card><Card><CardHeader><CardTitle><ShieldCheck data-icon="inline-start" />安全状态</CardTitle><CardDescription>敏感凭据只允许进入系统安全存储。</CardDescription></CardHeader><CardContent><div className="security-status"><span className={info?.secureStorageAvailable ? 'status-dot' : 'status-dot status-dot-muted'} />{info?.secureStorageAvailable ? '系统安全存储可用' : '系统安全存储不可用'}</div><p className="settings-note">v0.1 不上传 Cookie、登录会话和代理凭据。</p></CardContent></Card></div></section> : null}
            </div>
          </ScrollArea>
        </main>
      </div>
    </TooltipProvider>
  )
}

export default App
