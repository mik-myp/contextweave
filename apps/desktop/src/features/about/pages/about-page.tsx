import { ExternalLinkIcon } from 'lucide-react'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { PageHeading } from '@/components/page-heading'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import notices from '../../../../../../THIRD_PARTY_NOTICES.md?raw'
export function AboutPage() {
  const { t } = useI18n()
  const { appInfo, appError, setNotice, refresh } = useAppData()
  const open = async (url: string) => {
    try {
      await unwrapIpc(window.contextweave.app.openExternal(url))
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : t('admin.operationError'),
      })
    }
  }
  return (
    <div className="flex max-w-3xl flex-col gap-(--section-gap)">
      <PageHeading title={t('about.title')} description={t('about.description')} />
      {appError ? (
        <Alert variant="destructive">
          <AlertDescription>{appError}</AlertDescription>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : (
        <dl className="grid gap-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">{t('about.version')}</dt>
            <dd className="mt-1 font-medium">{appInfo?.version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t('about.platform')}</dt>
            <dd className="mt-1 font-medium">
              {appInfo ? `${appInfo.platform} / ${appInfo.arch}` : '—'}
            </dd>
          </div>
        </dl>
      )}
      <Separator />
      <section className="flex flex-col gap-5" aria-labelledby="credits-title">
        <h2 id="credits-title" className="text-lg font-medium">
          {t('about.credits')}
        </h2>
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="link"
            className="h-auto px-0"
            onClick={() => void open('https://github.com/QuantumNous/new-api')}
          >
            New API <ExternalLinkIcon />
          </Button>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('about.newApi')}</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="link"
            className="h-auto px-0"
            onClick={() => void open('https://github.com/satnaing/shadcn-admin')}
          >
            shadcn-admin <ExternalLinkIcon />
          </Button>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('about.shadcnAdmin')}</p>
        </div>
      </section>
      <Accordion>
        <AccordionItem value="notices">
          <AccordionTrigger>{t('about.license')}</AccordionTrigger>
          <AccordionContent>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
              {notices}
            </pre>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
