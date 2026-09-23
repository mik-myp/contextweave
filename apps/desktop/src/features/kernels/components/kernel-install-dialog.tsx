import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { customKernelSourceSchema, type KernelRelease } from '@contextweave/contracts'
import { DownloadIcon, RefreshCwIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAppData } from '@/app/use-app-data'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { KernelDownloadTasks } from './kernel-download-tasks'
import { KernelCustomSourceFields, type KernelSourceDraft } from './kernel-custom-source-fields'

export function KernelInstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, locale } = useI18n()
  const { setNotice, refresh } = useAppData(['kernels'])
  const client = useQueryClient()
  const [providerId, setProviderId] = useState('fingerprint-chromium')
  const [mode, setMode] = useState('official')
  const [draft, setDraft] = useState<KernelSourceDraft>({
    url: '',
    version: '',
    sha256: '',
    trustedSource: false,
  })
  const [customRelease, setCustomRelease] = useState<KernelRelease>()
  const [selected, setSelected] = useState<string>()
  const [pending, setPending] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()
  const providers = useQuery({
    queryKey: ['local', 'kernels', 'providers'],
    queryFn: () => unwrapIpc(window.contextweave.kernel.providers()),
    enabled: open,
  })
  const catalog = useQuery({
    queryKey: ['local', 'kernels', 'catalog', providerId],
    queryFn: () => unwrapIpc(window.contextweave.kernel.catalog(providerId)),
    enabled: open,
  })
  const releases = (catalog.data?.releases ?? []).filter((item) => item.sourceType !== 'custom')
  const official =
    releases.find((item) => item.id === selected) ??
    releases.find((item) => item.installable) ??
    releases[0]
  const release =
    mode === 'official'
      ? official
      : (catalog.data?.releases.find((item) => item.id === customRelease?.id) ?? customRelease)
  const state = release?.installation
  const installing = Boolean(
    (pending && pending === release?.id) ||
    (state && ['downloading', 'verifying', 'extracting'].includes(state.phase)),
  )
  const cancelInstall = (id: string) => {
    void unwrapIpc(window.contextweave.kernel.cancelInstall(id)).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t('admin.operationError'))
    })
  }
  const updateCatalog = async () => {
    setRefreshing(true)
    try {
      client.setQueryData(
        ['local', 'kernels', 'catalog', providerId],
        await unwrapIpc(window.contextweave.kernel.catalog(providerId, true)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.operationError'))
    } finally {
      setRefreshing(false)
    }
  }
  const install = async () => {
    if (installing || pending) return
    setError(undefined)
    setPending('preparing')
    try {
      let target = release
      if (mode === 'custom') {
        const parsed = customKernelSourceSchema.safeParse({
          providerId,
          url: draft.url.trim(),
          version: draft.version.trim() || undefined,
          sha256: draft.sha256.trim() || undefined,
          trustedSource: draft.trustedSource,
        })
        if (!parsed.success) throw new Error(t('kernel.customInputError'))
        target = await unwrapIpc(window.contextweave.kernel.prepareCustom(parsed.data))
        setCustomRelease(target)
      }
      if (!target?.installable) return
      setPending(target.id)
      await unwrapIpc(window.contextweave.kernel.install(target.id))
      await refresh()
      setNotice({ kind: 'success', message: `${t('kernel.installed')}: ${target.version}` })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.operationError'))
    } finally {
      setPending(undefined)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('kernel.install')}</DialogTitle>
          <DialogDescription>{t('kernel.versionInstallHelp')}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="kernel-provider">{t('kernel.provider')}</FieldLabel>
          <Select
            items={(providers.data ?? []).map((item) => ({ value: item.id, label: item.label }))}
            value={providerId}
            disabled={!!pending}
            onValueChange={(value) => {
              if (value) {
                setProviderId(value)
                setSelected(undefined)
                setCustomRelease(undefined)
                setError(undefined)
              }
            }}
          >
            <SelectTrigger id="kernel-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {providers.data?.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {providers.data?.find((item) => item.id === providerId)?.license}
          </FieldDescription>
        </Field>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(String(value))
            setError(undefined)
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="official" disabled={!!pending}>
              {t('kernel.officialReleases')}
            </TabsTrigger>
            <TabsTrigger value="custom" disabled={!!pending}>
              {t('kernel.downloadLink')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="official" className="pt-3">
            {catalog.isPending ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                {t('kernel.loadingVersions')}
              </p>
            ) : (
              official && (
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="kernel-release-version">{t('kernel.version')}</FieldLabel>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={refreshing || !!pending}
                      onClick={() => void updateCatalog()}
                      aria-label={t('kernel.refreshVersions')}
                    >
                      <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                  <Select
                    items={releases.map((item) => ({
                      value: item.id,
                      label: `${item.version}${item.installed ? ` · ${t('kernel.installed')}` : ''}`,
                    }))}
                    value={official.id}
                    disabled={!!pending}
                    onValueChange={(value) => {
                      if (value) {
                        setSelected(value)
                        setError(undefined)
                      }
                    }}
                  >
                    <SelectTrigger id="kernel-release-version">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {releases.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.version}
                            {item.installed ? ` · ${t('kernel.installed')}` : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>{t('kernel.keepVersions')}</FieldDescription>
                </Field>
              )
            )}
            {catalog.data && catalog.data.sourceStatus !== 'live' && (
              <Alert className="mt-4">
                <AlertDescription>{t('kernel.cachedCatalog')}</AlertDescription>
              </Alert>
            )}
          </TabsContent>
          <TabsContent value="custom" className="pt-3">
            <KernelCustomSourceFields
              value={draft}
              disabled={!!pending}
              onChange={(value) => {
                setDraft(value)
                setCustomRelease(undefined)
                setError(undefined)
              }}
            />
          </TabsContent>
        </Tabs>
        {release && (
          <>
            <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('kernel.platform')}</dt>
                <dd className="mt-1">
                  <Badge variant="info">
                    {release.platform === 'darwin'
                      ? 'macOS'
                      : release.platform === 'win32'
                        ? 'Windows'
                        : release.platform}{' '}
                    / {release.arch}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('kernel.packageSize')}</dt>
                <dd className="mt-1 tabular-nums">
                  {(release.sizeBytes ?? state?.totalBytes)
                    ? `${Math.round((release.sizeBytes ?? state?.totalBytes ?? 0) / 1048576)} MB`
                    : '—'}
                </dd>
              </div>
              {release.publishedAt && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">{t('kernel.publishedAt')}</dt>
                  <dd className="mt-1">
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                      new Date(release.publishedAt),
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {release.reason && (
              <Alert>
                <AlertDescription>
                  {t(
                    release.reason === 'PLATFORM_UNSUPPORTED'
                      ? 'kernel.platformHelp'
                      : release.reason === 'ADAPTER_UNSUPPORTED'
                        ? 'kernel.adapterUnsupported'
                        : 'kernel.checksumUnavailable',
                  )}
                </AlertDescription>
              </Alert>
            )}
            {installing && (
              <div role="status" className="flex flex-col gap-2">
                <p className="flex items-center gap-2 text-sm">
                  <Spinner />
                  {t(
                    state?.phase === 'extracting'
                      ? 'kernel.extracting'
                      : state?.phase === 'verifying'
                        ? 'kernel.verifying'
                        : 'kernel.downloading',
                  )}
                  <span className="ms-auto text-muted-foreground tabular-nums">
                    {Math.round((state?.receivedBytes ?? 0) / 1048576)} MB
                  </span>
                </p>
                <Progress
                  value={
                    state?.totalBytes
                      ? Math.round((state.receivedBytes / state.totalBytes) * 100)
                      : 0
                  }
                />
              </div>
            )}
            {!installing && !error && state?.errorCode && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(state.errorCode)}</AlertDescription>
              </Alert>
            )}
          </>
        )}
        {(error || catalog.error || providers.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {error ?? catalog.error?.message ?? providers.error?.message}
            </AlertDescription>
          </Alert>
        )}
        <KernelDownloadTasks
          releases={catalog.data?.releases ?? []}
          selectedId={release?.id}
          onCancel={cancelInstall}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          {installing && release ? (
            <Button variant="outline" onClick={() => cancelInstall(release.id)}>
              {t('kernel.cancelInstall')}
            </Button>
          ) : (
            <Button
              disabled={
                !!pending ||
                (mode === 'official'
                  ? !release?.installable || release.installed
                  : !draft.url.trim() || release?.installed)
              }
              onClick={() => void install()}
            >
              {pending ? <Spinner /> : <DownloadIcon />}
              {t(release?.installed ? 'kernel.installed' : 'kernel.downloadVersion')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
