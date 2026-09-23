import { EnvironmentPreflight } from './environment-preflight'
import { FormProvider } from 'react-hook-form'
import { ArrowLeftIcon } from 'lucide-react'
import type { EnvironmentDetails } from '@contextweave/contracts'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { EnvironmentBasicFields } from './environment-basic-fields'
import { EnvironmentProxyFields } from './environment-proxy-fields'
import { EnvironmentBrowserFields } from './environment-browser-fields'
import { EnvironmentConfirmDialog } from './environment-confirm-dialog'
import { useEnvironmentEditor } from '../hooks/use-environment-editor'

export function EnvironmentEditor({ detail }: { detail?: EnvironmentDetails }) {
  const { t } = useI18n()
  const editor = useEnvironmentEditor(detail)
  const { form } = editor
  const submitting = form.formState.isSubmitting
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={editor.submit}
        className="mx-auto flex w-full max-w-3xl flex-col gap-(--section-gap) pb-8"
        aria-label={t(detail ? 'env.editTitle' : 'env.newTitle')}
      >
        <div className="sticky -top-4 z-10 -mt-4 flex flex-col gap-4 bg-background pt-4 md:-top-(--page-padding) md:-mt-(--page-padding) md:pt-(--page-padding)">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={t('env.back')}
                onClick={() => void editor.back()}
                disabled={submitting || editor.stopping}
              >
                <ArrowLeftIcon className="rtl:rotate-180" />
              </Button>
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {t(detail ? 'env.editTitle' : 'env.newTitle')}
              </h1>
            </div>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {form.formState.isDirty && <Badge variant="outline">{t('env.unsaved')}</Badge>}
              <Button
                type="button"
                variant="outline"
                onClick={() => void editor.back()}
                disabled={submitting || editor.stopping}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={editor.disabled || (!!detail && !form.formState.isDirty)}
              >
                {submitting && <Spinner data-icon="inline-start" />}
                {t(submitting ? 'env.saving' : detail ? 'env.save' : 'env.create')}
              </Button>
            </div>
          </div>
          <Separator />
        </div>
        {editor.error && (
          <Alert variant="destructive">
            <AlertTitle>{t('env.operationError')}</AlertTitle>
            <AlertDescription>{editor.error}</AlertDescription>
            {editor.retryConfiguration && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void editor.retryConfiguration?.()}
              >
                {t('common.retry')}
              </Button>
            )}
          </Alert>
        )}
        {editor.readOnly && (
          <Alert>
            <AlertTitle>{t('env.readOnly')}</AlertTitle>
            <AlertDescription>
              {t(
                editor.status === 'needs-recovery'
                  ? 'env.recoveryDescription'
                  : 'env.readOnlyDescription',
              )}
            </AlertDescription>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                editor.stopping || editor.status === 'stopping' || editor.status === 'starting'
              }
              onClick={() => editor.setStopOpen(true)}
            >
              {t(editor.status === 'needs-recovery' ? 'env.recover' : 'env.stopToEdit')}
            </Button>
          </Alert>
        )}
        <EnvironmentBasicFields
          kernels={editor.kernels}
          disabled={editor.disabled}
          editing={!!detail}
          kernelVersion={detail?.kernelVersion}
          onManage={() => void editor.manage('/kernels')}
        />
        <Separator />
        <EnvironmentProxyFields
          proxies={editor.proxies}
          disabled={editor.disabled}
          onManage={() => void editor.manage('/proxies')}
        />
        <Separator />
        <EnvironmentBrowserFields
          disabled={editor.disabled}
          expanded={editor.expanded}
          onExpandedChange={editor.setExpanded}
        />
        <Separator />
        <EnvironmentPreflight detail={detail} />
      </form>
      <EnvironmentConfirmDialog
        kind="stop"
        open={editor.stopOpen}
        onOpenChange={editor.setStopOpen}
        pending={editor.stopping}
        onConfirm={() => void editor.stop()}
      />
      <EnvironmentConfirmDialog
        kind="discard"
        open={editor.blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) editor.blocker.reset?.()
        }}
        pending={submitting || editor.stopping}
        onConfirm={editor.discard}
      />
    </FormProvider>
  )
}
