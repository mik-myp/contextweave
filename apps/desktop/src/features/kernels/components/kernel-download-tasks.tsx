import type { KernelRelease } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export function KernelDownloadTasks({
  releases,
  selectedId,
  onCancel,
}: {
  releases: KernelRelease[]
  selectedId?: string
  onCancel: (id: string) => void
}) {
  const { t } = useI18n()
  const active = releases.filter(
    (release) =>
      release.id !== selectedId &&
      release.installation &&
      ['downloading', 'verifying', 'extracting'].includes(release.installation.phase),
  )
  if (!active.length) return null
  return (
    <section aria-label={t('kernel.backgroundDownloads')} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t('kernel.backgroundDownloads')}</h3>
      {active.map((release) => {
        const state = release.installation!
        return (
          <div key={release.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{release.version}</span>
              <Badge variant="secondary">
                {t(
                  release.sourceType === 'custom'
                    ? 'kernel.downloadLink'
                    : 'kernel.officialReleases',
                )}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="ms-auto"
                onClick={() => onCancel(release.id)}
              >
                {t('kernel.cancelInstall')}
              </Button>
            </div>
            <Progress
              aria-label={release.version}
              value={
                state.totalBytes ? Math.round((state.receivedBytes / state.totalBytes) * 100) : null
              }
            />
          </div>
        )
      })}
    </section>
  )
}
