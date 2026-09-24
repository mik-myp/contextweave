import {
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  PackageOpenIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { SettingsSection } from '../components/settings-section'

import { useAppUpdate } from '../hooks/use-app-update'

export function SettingsUpdatesPage() {
  const { t, locale } = useI18n()
  const { appInfo } = useAppData(['app'])
  const { state, command, loading, error, openRelease } = useAppUpdate()
  const phase = state?.phase ?? 'idle'
  const release = state?.release
  const busy = ['checking', 'downloading', 'installing'].includes(phase) || command.isPending
  const progress = state?.totalBytes
    ? Math.min(100, Math.round((state.receivedBytes / state.totalBytes) * 100))
    : 0
  return (
    <SettingsSection title={t('settings.updates')} description={t('update.description')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{t('update.currentVersion')}</span>
          <span className="font-medium tabular-nums">
            {state?.currentVersion ?? appInfo?.version ?? '—'}
          </span>
          <span className="text-xs text-muted-foreground">
            {appInfo
              ? `${appInfo.platform === 'darwin' ? 'macOS' : appInfo.platform === 'win32' ? 'Windows' : appInfo.platform} / ${appInfo.arch}`
              : '—'}
          </span>
        </div>
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => command.mutate('check')}
        >
          {phase === 'checking' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {t(phase === 'checking' ? 'update.checking' : 'update.check')}
        </Button>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {phase === 'current' && (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2Icon className="size-4 text-success" />
            {t('update.current')}
          </p>
        )}
        {phase === 'idle' && <p className="text-sm text-muted-foreground">{t('update.idle')}</p>}
        {phase === 'cancelled' && (
          <p className="text-sm text-muted-foreground">{t('update.cancelled')}</p>
        )}
        {state?.checkedAt && (
          <p className="text-xs text-muted-foreground">
            {t('update.lastChecked')}: {new Date(state.checkedAt).toLocaleString(locale)}
          </p>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {release && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              ContextWeave {release.version}
              <Badge variant="info">{t('update.stable')}</Badge>
            </CardTitle>
            <CardDescription>
              {t('update.published')}: {new Date(release.publishedAt).toLocaleDateString(locale)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('update.availableHelp')}</p>
            {phase === 'unsupported' && (
              <Alert>
                <AlertDescription>{t('update.unsupported')}</AlertDescription>
              </Alert>
            )}
            {release.asset && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="break-all">{release.asset.fileName}</span>
                <span className="tabular-nums">
                  {Math.ceil(release.asset.sizeBytes / 1048576)} MB
                </span>
              </div>
            )}
            {phase === 'downloading' && (
              <div role="status" className="flex flex-col gap-2">
                <Progress value={progress} aria-label={t('update.downloading')} />
                <p className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>
                    {t('update.downloading')} · {Math.round((state?.receivedBytes ?? 0) / 1048576)}{' '}
                    / {Math.ceil((state?.totalBytes ?? 0) / 1048576)} MB
                  </span>
                  <span>{progress}%</span>
                </p>
              </div>
            )}
            {phase === 'installing' && <p role="status">{t('update.installing')}</p>}
            {phase === 'ready' && (
              <Alert>
                <AlertDescription>{t('update.ready')}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {phase === 'downloading' ? (
              <Button
                variant="outline"
                disabled={command.isPending && command.variables === 'cancel'}
                onClick={() => command.mutate('cancel')}
              >
                {t('update.cancelDownload')}
              </Button>
            ) : phase === 'ready' ? (
              <Button disabled={busy} onClick={() => command.mutate('openInstaller')}>
                <PackageOpenIcon data-icon="inline-start" />
                {t('update.openInstaller')}
              </Button>
            ) : (
              release.asset && (
                <Button disabled={busy} onClick={() => command.mutate('install')}>
                  <DownloadIcon data-icon="inline-start" />
                  {t('update.download')}
                </Button>
              )
            )}
            <Button variant="outline" onClick={() => void openRelease()}>
              <ExternalLinkIcon data-icon="inline-start" />
              {t('update.releaseNotes')}
            </Button>
          </CardFooter>
        </Card>
      )}
      <p className="text-sm leading-relaxed text-muted-foreground">{t('update.manualHelp')}</p>
    </SettingsSection>
  )
}
