import { Link } from '@tanstack/react-router'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { KernelCapabilities } from '@/features/kernels/components/kernel-capabilities'
export function FingerprintPage() {
  const { t } = useI18n()
  const { kernels, loading, kernelError, refresh } = useAppData()
  return (
    <>
      <h1 className="sr-only">{t('fingerprint.title')}</h1>
      <div className="flex justify-end">
        <Link to="/environments" className={buttonVariants({ variant: 'outline' })}>
          {t('fingerprint.configure')}
        </Link>
      </div>
      {kernelError ? (
        <Alert variant="destructive">
          <AlertDescription>{kernelError}</AlertDescription>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : loading ? (
        <Skeleton className="h-60" />
      ) : !kernels.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('kernel.empty')}</EmptyTitle>
            <EmptyDescription>{t('kernel.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {kernels.map((kernel) => (
            <Card key={kernel.id}>
              <CardHeader>
                <CardTitle>{kernel.label}</CardTitle>
                <CardDescription>
                  {kernel.platform} / {kernel.arch} · {kernel.version}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <KernelCapabilities capabilities={kernel.capabilities} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
