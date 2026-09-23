import { CheckIcon, MinusIcon } from 'lucide-react'
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
export function KernelCapabilities({ capabilities }: { capabilities: Record<string, boolean> }) {
  const { t } = useI18n()
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {Object.entries(capabilities).map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-3 text-sm">
          <dt>{labels[key] ? t(labels[key]) : key}</dt>
          <dd>
            <Badge variant={value ? 'secondary' : 'outline'}>
              {value ? (
                <CheckIcon data-icon="inline-start" />
              ) : (
                <MinusIcon data-icon="inline-start" />
              )}
              {t(value ? 'kernel.supported' : 'kernel.unsupported')}
            </Badge>
          </dd>
        </div>
      ))}
    </dl>
  )
}
