import * as React from 'react'
import {
  CheckCircle2Icon,
  CpuIcon,
  CircleAlertIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SlidersHorizontalIcon,
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useTheme } from '@/theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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
  const selectPage = (title: string) =>
    setPage(title === '关于 ContextWeave' ? 'about' : (pageByNav[title] ?? 'environments'))
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
                {page === 'about' ? '关于 ContextWeave' : (navByPage[page] ?? '环境')}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} aria-label="刷新">
              <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
            </Button>
          </header>
          <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4 md:p-6">
            {notice && (
              <Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
                {notice.kind === 'error' ? <CircleAlertIcon /> : <CheckCircle2Icon />}
                <AlertDescription>{notice.message}</AlertDescription>
                <AlertAction>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setNotice(undefined)}
                    aria-label="关闭提示"
                  >
                    ×
                  </Button>
                </AlertAction>
              </Alert>
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
            {page === 'about' && <AboutPage appInfo={appInfo} />}
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
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<EnvironmentSummary>()
  const [editName, setEditName] = React.useState('')
  const [editProxyId, setEditProxyId] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<EnvironmentSummary>()
  const [saving, setSaving] = React.useState(false)
  const selected = environments.find((item) => item.id === selectedEnvironment)
  const create = async () => {
    if (saving) return
    setSaving(true)
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
      setCreateOpen(false)
      await onRefresh()
      onSelect(result.data.id)
    } else onNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }
  const openEdit = (environment: EnvironmentSummary) => {
    setEditing(environment)
    setEditName(environment.name)
    setEditProxyId(environment.proxyId ?? '')
  }
  const update = async () => {
    if (!editing || saving) return
    setSaving(true)
    const result = await window.contextweave.environment.update({
      version: 1,
      environmentId: editing.id,
      name: editName,
      proxyId: editProxyId || null,
    })
    if (result.ok) {
      onNotice({ kind: 'success', message: '环境配置已更新' })
      setEditing(undefined)
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }
  const remove = async () => {
    if (!deleteTarget || saving) return
    setSaving(true)
    const result = await window.contextweave.environment.delete(deleteTarget.id)
    if (result.ok) {
      onNotice({ kind: 'success', message: `环境“${deleteTarget.name}”已删除` })
      setDeleteTarget(undefined)
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }
  const canManage = (environment: EnvironmentSummary) =>
    !['starting', 'running', 'stopping', 'needs-recovery'].includes(environment.status)
  const visibleEnvironments = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return environments.filter((environment) => {
      const matchesSearch =
        !normalizedSearch ||
        [environment.name, environment.kernelId, environment.proxyId ?? '']
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch)
      const matchesStatus = statusFilter === 'all' || environment.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [environments, search, statusFilter])
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 pb-3">
        <Badge variant="secondary">{environments.length} 个环境</Badge>
        {selected && (
          <span className="text-xs text-muted-foreground">当前选择：{selected.name}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Input
            className="h-8 w-44"
            placeholder="搜索环境"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索环境"
          />
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? 'all')}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部状态</SelectItem>
                {Object.keys({
                  created: true,
                  ready: true,
                  starting: true,
                  running: true,
                  stopping: true,
                  stopped: true,
                  error: true,
                  'needs-recovery': true,
                }).map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(status as EnvironmentSummary['status'])}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            新建环境
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {environments.length && visibleEnvironments.length ? (
          <Table>
            <TableHeader className="bg-muted/30 [&_tr]:border-0">
              <TableRow className="border-0">
                <TableHead>环境</TableHead>
                <TableHead>内核</TableHead>
                <TableHead>代理</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEnvironments.map((item) => (
                <TableRow
                  key={item.id}
                  data-state={selectedEnvironment === item.id ? 'selected' : undefined}
                  className="cursor-pointer border-border/50"
                  onClick={() => onSelect(item.id)}
                >
                  <TableCell>
                    <div className="flex cursor-pointer items-center gap-2">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <GlobeIcon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.platform}/{item.arch}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.kernelId} · {item.kernelVersion}
                  </TableCell>
                  <TableCell>
                    {item.proxyId
                      ? (proxies.find((proxy) => proxy.proxyId === item.proxyId)?.host ?? '已绑定')
                      : '未使用'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={(event) => event.stopPropagation()}
                            aria-label={'打开' + item.name + '的操作菜单'}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            disabled={!canManage(item)}
                            onClick={() => openEdit(item)}
                          >
                            <PencilIcon />
                            编辑
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!canManage(item)}
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Trash2Icon />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : environments.length ? (
          <Empty className="min-h-48 bg-muted/30">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon />
              </EmptyMedia>
              <EmptyTitle>没有匹配的环境</EmptyTitle>
              <EmptyDescription>调整搜索或状态筛选条件后重试。</EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
              }}
            >
              重置筛选
            </Button>
          </Empty>
        ) : (
          <Empty className="min-h-48 bg-muted/30">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon />
              </EmptyMedia>
              <EmptyTitle>暂无环境</EmptyTitle>
              <EmptyDescription>创建一个本地环境后，它会出现在这里。</EmptyDescription>
            </EmptyHeader>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              新建环境
            </Button>
          </Empty>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GlobeIcon />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-medium">{selected.name}</div>
                <Badge variant={statusVariant(selected.status)}>
                  {statusLabel(selected.status)}
                </Badge>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {selected.kernelId} · {selected.kernelVersion} ·{' '}
                {selected.proxyId
                  ? (proxies.find((proxy) => proxy.proxyId === selected.proxyId)?.host ??
                    '已绑定代理')
                  : '未使用代理'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void start()}
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
              onClick={() => void stop()}
              disabled={selected.status !== 'running' && selected.status !== 'starting'}
            >
              <SquareIcon data-icon="inline-start" />
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
              <CheckCircle2Icon data-icon="inline-start" />
              Worker Smoke
            </Button>
          </div>
        </div>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建环境</DialogTitle>
            <DialogDescription>配置后将创建独立的本地用户目录。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="environment-name">名称</FieldLabel>
              <Input
                id="environment-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="environment-kernel">浏览器内核</FieldLabel>
              <Select value={kernelId} onValueChange={(value) => setKernelId(value ?? '')}>
                <SelectTrigger id="environment-kernel" className="w-full">
                  <SelectValue placeholder="选择内核" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {kernels.map((kernel) => (
                      <SelectItem key={kernel.id} value={kernel.id}>
                        {kernel.label} · {kernel.version}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="environment-proxy">代理（可选）</FieldLabel>
              <Select
                value={proxyId || 'none'}
                onValueChange={(value) => setProxyId(value === 'none' ? '' : (value ?? ''))}
              >
                <SelectTrigger id="environment-proxy" className="w-full">
                  <SelectValue placeholder="不使用代理" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">不使用代理</SelectItem>
                    {proxies.map((proxy) => (
                      <SelectItem key={proxy.proxyId} value={proxy.proxyId}>
                        {proxy.type.toUpperCase()} · {proxy.host}:{proxy.port}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void create()} disabled={!name.trim() || saving}>
              {saving && <Spinner />}
              创建环境
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑环境</DialogTitle>
            <DialogDescription>内核和用户目录属于环境身份，编辑时保持不变。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-environment-name">名称</FieldLabel>
              <Input
                id="edit-environment-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-environment-proxy">代理（可选）</FieldLabel>
              <Select
                value={editProxyId || 'none'}
                onValueChange={(value) => setEditProxyId(value === 'none' ? '' : (value ?? ''))}
              >
                <SelectTrigger id="edit-environment-proxy" className="w-full">
                  <SelectValue placeholder="不使用代理" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">不使用代理</SelectItem>
                    {proxies.map((proxy) => (
                      <SelectItem key={proxy.proxyId} value={proxy.proxyId}>
                        {proxy.type.toUpperCase()} · {proxy.host}:{proxy.port}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)}>
              取消
            </Button>
            <Button onClick={() => void update()} disabled={!editName.trim() || saving}>
              {saving && <Spinner />}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除环境“{deleteTarget?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              只删除环境元数据，profile 目录和运行记录会保留，方便后续手动恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void remove()}
              disabled={saving}
            >
              {saving && <Spinner />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProxySummary>()
  const [saving, setSaving] = React.useState(false)
  const [type, setType] = React.useState<ProxyType>('http')
  const [host, setHost] = React.useState('127.0.0.1')
  const [port, setPort] = React.useState('8080')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [search, setSearch] = React.useState('')
  const save = async () => {
    if (saving) return
    setSaving(true)
    const config: ProxyConfig = { type, host, port: Number(port), username: username || undefined }
    const result = await window.contextweave.proxy.save({
      proxyId: editing,
      config,
      password: password || undefined,
    })
    if (result.ok) {
      onNotice({ kind: 'success', message: '代理配置已保存，密码仅保存在系统安全存储中。' })
      setEditing(undefined)
      setDialogOpen(false)
      setPassword('')
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
    setSaving(false)
  }
  const edit = (proxy: ProxySummary) => {
    setEditing(proxy.proxyId)
    setType(proxy.type as ProxyType)
    setHost(proxy.host)
    setPort(String(proxy.port))
    setUsername(proxy.username ?? '')
    setPassword('')
    setDialogOpen(true)
  }
  const add = () => {
    setEditing(undefined)
    setType('http')
    setHost('127.0.0.1')
    setPort('8080')
    setUsername('')
    setPassword('')
    setDialogOpen(true)
  }
  const remove = async (proxyId: string) => {
    if (saving) return
    setSaving(true)
    const result = await window.contextweave.proxy.delete(proxyId)
    if (result.ok) {
      onNotice({ kind: 'success', message: '代理已删除' })
      await onRefresh()
    } else onNotice({ kind: 'error', message: result.message })
    setDeleteTarget(undefined)
    setSaving(false)
  }
  const visibleProxies = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return proxies
    return proxies.filter((proxy) =>
      [proxy.type, proxy.host, proxy.port, proxy.username ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch),
    )
  }, [proxies, search])
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 pb-3">
        <Badge variant="secondary">{proxies.length} 个代理</Badge>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Input
            className="h-8 w-44"
            placeholder="搜索代理"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索代理"
          />
          <Button size="sm" onClick={add}>
            <PlusIcon data-icon="inline-start" />
            新建代理
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {proxies.length && visibleProxies.length ? (
          <Table>
            <TableHeader className="bg-muted/30 [&_tr]:border-0">
              <TableRow className="border-0">
                <TableHead>类型</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>认证</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProxies.map((proxy) => (
                <TableRow key={proxy.proxyId} className="border-border/50">
                  <TableCell>
                    <Badge variant="outline">{proxy.type.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell>
                    {proxy.host}:{proxy.port}
                  </TableCell>
                  <TableCell>{proxy.username ? '用户 ' + proxy.username : '无认证'}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={'打开' + proxy.host + '的操作菜单'}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => edit(proxy)}>
                            <PencilIcon />
                            编辑
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(proxy)}
                          >
                            <Trash2Icon />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : proxies.length ? (
          <Empty className="min-h-48 bg-muted/30">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SlidersHorizontalIcon />
              </EmptyMedia>
              <EmptyTitle>没有匹配的代理</EmptyTitle>
              <EmptyDescription>调整搜索条件后重试。</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={() => setSearch('')}>
              清除搜索
            </Button>
          </Empty>
        ) : (
          <Empty className="min-h-48 bg-muted/30">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SlidersHorizontalIcon />
              </EmptyMedia>
              <EmptyTitle>暂无代理</EmptyTitle>
              <EmptyDescription>添加代理后，可以在环境创建或编辑时绑定。</EmptyDescription>
            </EmptyHeader>
            <Button onClick={add}>
              <PlusIcon data-icon="inline-start" />
              新建代理
            </Button>
          </Empty>
        )}
      </div>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑代理' : '添加代理'}</DialogTitle>
            <DialogDescription>
              HTTP、HTTPS 或 SOCKS5。密码仅保存在系统安全存储中。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="proxy-type">类型</FieldLabel>
              <Select
                value={type}
                onValueChange={(value) => setType((value ?? 'http') as ProxyType)}
              >
                <SelectTrigger id="proxy-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="https">HTTPS</SelectItem>
                    <SelectItem value="socks5">SOCKS5</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <Field>
                <FieldLabel htmlFor="proxy-host">主机</FieldLabel>
                <Input
                  id="proxy-host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-port">端口</FieldLabel>
                <Input
                  id="proxy-port"
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="proxy-username">用户名（可选）</FieldLabel>
              <Input
                id="proxy-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="proxy-password">密码（可选）</FieldLabel>
              <Input
                id="proxy-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={editing ? '留空表示保持原密码' : ''}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={!host.trim() || !port || saving}>
              {saving && <Spinner />}
              保存代理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除代理“{deleteTarget?.host}:{deleteTarget?.port}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              如果仍有环境绑定此代理，删除会被拒绝。删除后不会影响已保留的环境目录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTarget && void remove(deleteTarget.proxyId)}
              disabled={saving}
            >
              {saving && <Spinner />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <Badge variant="secondary">{kernels.length} 个内核</Badge>
        <span className="text-xs text-muted-foreground">本机可用与已配置内核</span>
      </div>
      <div className="divide-y divide-border/60">
        {kernels.map((kernel) => (
          <div key={kernel.id} className="flex flex-wrap items-center gap-4 py-4">
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
                <Button size="sm" onClick={() => void install(kernel.id)}>
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
                  <CheckCircle2Icon
                    className={value ? 'text-primary' : 'text-muted-foreground/40'}
                  />
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
    </div>
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

function AboutPage({
  appInfo,
}: {
  appInfo?: {
    name: string
    version: string
    platform: string
    arch: string
    secureStorageAvailable: boolean
  }
}) {
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

function ThemeSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(nextValue) => nextValue && onChange(nextValue)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map(([optionValue, optionLabel]) => (
              <SelectItem key={optionValue} value={optionValue}>
                {optionLabel}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
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
function FingerprintPage() {
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

export default App
