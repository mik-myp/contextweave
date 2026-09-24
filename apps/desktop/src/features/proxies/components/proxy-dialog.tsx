import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { proxyTypeSchema, type ProxyTestResult as TestResult } from '@contextweave/contracts'
import type { ProxySummary } from '@/shared/types/app'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { proxyFormSchema, toSaveProxyInput, type ProxyFormValues } from '../proxy-form'

import { ProxyTestResult } from './proxy-test-result'

const protocols = proxyTypeSchema.options.map((value) => ({ value, label: value.toUpperCase() }))
export function ProxyDialog({ proxy, onClose }: { proxy?: ProxySummary; onClose: () => void }) {
  const { t } = useI18n()
  const { refresh, setNotice, appInfo } = useAppData(['proxies', 'app'])
  const [error, setError] = useState<string>()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult>()
  const testRevision = useRef(0)
  const [discard, setDiscard] = useState(false)
  const form = useForm<ProxyFormValues>({
    resolver: zodResolver(proxyFormSchema(t)),
    defaultValues: {
      name: proxy?.name ?? '',
      type: proxy?.type ?? 'http',
      host: proxy?.host ?? '',
      port: String(proxy?.port ?? 8080),
      username: proxy?.username ?? '',
      password: '',
      clearPassword: false,
    },
  })
  useEffect(() => {
    const subscription = form.watch(() => {
      testRevision.current += 1
      setTestResult(undefined)
    })
    return () => {
      subscription.unsubscribe()
      testRevision.current += 1
    }
  }, [form])
  const test = form.handleSubmit(async (values) => {
    if (testing) return
    const revision = testRevision.current
    setTesting(true)
    setError(undefined)
    setTestResult(undefined)
    try {
      const result = await unwrapIpc(
        window.contextweave.proxy.test(toSaveProxyInput(values, proxy?.proxyId)),
      )
      if (revision === testRevision.current) setTestResult(result)
    } catch (cause) {
      if (revision === testRevision.current)
        setError(cause instanceof Error ? cause.message : t('admin.operationError'))
    } finally {
      setTesting(false)
    }
  })
  const { errors, isDirty, isSubmitting } = form.formState
  const requestClose = () => {
    if (!isSubmitting) {
      if (isDirty) setDiscard(true)
      else onClose()
    }
  }
  const submit = form.handleSubmit(async (values) => {
    setError(undefined)
    try {
      await unwrapIpc(window.contextweave.proxy.save(toSaveProxyInput(values, proxy?.proxyId)))
      await refresh()
      setNotice({ kind: 'success', message: t('admin.saved') })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.operationError'))
    }
  })
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto" showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>{t(proxy ? 'proxy.edit' : 'proxy.new')}</DialogTitle>
            <DialogDescription>{t('proxy.description')}</DialogDescription>
          </DialogHeader>
          <form id="proxy-editor" className="flex flex-col gap-5" noValidate onSubmit={submit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="proxy-name">{t('proxy.name')}</FieldLabel>
                <Input
                  id="proxy-name"
                  maxLength={80}
                  autoComplete="off"
                  disabled={isSubmitting}
                  placeholder={t('proxy.namePlaceholder')}
                  {...form.register('name')}
                />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-type">{t('proxy.type')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select
                      items={protocols}
                      value={field.value}
                      onValueChange={(value) => {
                        if (value) field.onChange(value)
                      }}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="proxy-type" onBlur={field.onBlur}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent aria-label={t('proxy.type')}>
                        <SelectGroup>
                          {protocols.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>{t('proxy.typeHelp')}</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                <Field data-invalid={!!errors.host}>
                  <FieldLabel htmlFor="proxy-host">{t('proxy.host')}</FieldLabel>
                  <Input
                    id="proxy-host"
                    placeholder="127.0.0.1"
                    autoComplete="off"
                    dir="ltr"
                    disabled={isSubmitting}
                    aria-invalid={!!errors.host}
                    aria-describedby={errors.host ? 'proxy-host-error' : undefined}
                    {...form.register('host')}
                  />
                  <FieldError id="proxy-host-error" errors={[errors.host]} />
                </Field>
                <Field data-invalid={!!errors.port}>
                  <FieldLabel htmlFor="proxy-port">{t('proxy.port')}</FieldLabel>
                  <Input
                    id="proxy-port"
                    inputMode="numeric"
                    dir="ltr"
                    disabled={isSubmitting}
                    aria-invalid={!!errors.port}
                    aria-describedby={errors.port ? 'proxy-port-error' : undefined}
                    {...form.register('port')}
                  />
                  <FieldError id="proxy-port-error" errors={[errors.port]} />
                </Field>
              </div>
              <Field data-invalid={!!errors.username}>
                <FieldLabel htmlFor="proxy-username">{t('proxy.username')}</FieldLabel>
                <Input
                  id="proxy-username"
                  autoComplete="off"
                  disabled={isSubmitting}
                  aria-invalid={!!errors.username}
                  aria-describedby={errors.username ? 'proxy-username-error' : 'proxy-auth-help'}
                  {...form.register('username')}
                />
                <FieldError id="proxy-username-error" errors={[errors.username]} />
                <FieldDescription id="proxy-auth-help">{t('proxy.authHelp')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-password">{t('proxy.password')}</FieldLabel>
                <Input
                  id="proxy-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={proxy?.hasPassword ? t('proxy.passwordKeep') : undefined}
                  disabled={
                    isSubmitting ||
                    form.watch('clearPassword') ||
                    appInfo?.secureStorageAvailable === false
                  }
                  {...form.register('password')}
                />
                {appInfo?.secureStorageAvailable === false && (
                  <FieldDescription>{t('proxy.secureUnavailable')}</FieldDescription>
                )}
              </Field>
              {proxy?.hasPassword && (
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="clearPassword"
                    render={({ field }) => (
                      <Checkbox
                        id="proxy-clear-password"
                        checked={field.value}
                        onCheckedChange={(value) => {
                          field.onChange(value)
                          if (value) form.setValue('password', '')
                        }}
                        disabled={isSubmitting}
                      />
                    )}
                  />
                  <FieldLabel htmlFor="proxy-clear-password">{t('proxy.clearPassword')}</FieldLabel>
                </Field>
              )}
            </FieldGroup>
          </form>
          <ProxyTestResult result={testResult} />
          <p className="text-xs text-muted-foreground">{t('proxy.testDescription')}</p>
          <DialogFooter>
            <Button
              variant="outline"
              className="sm:me-auto"
              disabled={testing || isSubmitting}
              onClick={() => void test()}
            >
              {testing && <Spinner />}
              {t(testing ? 'proxy.testing' : 'proxy.test')}
            </Button>
            <Button variant="outline" disabled={isSubmitting} onClick={requestClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="proxy-editor"
              disabled={isSubmitting || (!!proxy && !isDirty)}
            >
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {t('admin.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t('env.leaveTitle')}
        description={t('env.leaveDescription')}
        actionLabel={t('env.discard')}
        onConfirm={onClose}
      />
    </>
  )
}
