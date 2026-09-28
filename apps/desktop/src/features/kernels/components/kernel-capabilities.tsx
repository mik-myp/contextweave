import type { CapabilityEvidence } from '@contextweave/contracts'
import { useI18n, type TranslationKey } from '@/i18n'
import { Badge } from '@/components/ui/badge'
const labels: Record<string, TranslationKey> = {
  cdp: 'cap.cdp',
  screenshot: 'cap.screenshot',
  fileUpload: 'cap.fileUpload',
  proxy: 'cap.proxy',
  timezone: 'cap.timezone',
  webRtcPolicy: 'cap.webrtc',
  elementScreenshot: 'cap.elementScreenshot',
  userAgent: 'cap.userAgent',
}
export function KernelCapabilities({ report }: { report: Record<string, CapabilityEvidence> }) {
  const { t, locale } = useI18n()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('life.capHelp')}</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries(report).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 text-sm">
            <dt>{labels[key] ? t(labels[key]) : key}</dt>
            <dd className="flex flex-col items-end gap-1">
              <Badge
                variant={
                  value.state === 'verified'
                    ? 'success'
                    : value.state === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {t(`life.cap.${value.state}`)}
              </Badge>
              {value.checkedAt && (
                <span className="text-right text-xs text-muted-foreground" title={value.evidence}>
                  {value.version}
                  <br />
                  {new Date(value.checkedAt).toLocaleString(locale)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
