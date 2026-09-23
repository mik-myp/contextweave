import { useEffect, useRef, useState } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { EnvironmentDetails } from '@contextweave/contracts'
import { useAppData } from '@/app/use-app-data'
import { useI18n } from '@/i18n'
import { useEnvironmentDrafts } from '../environment-draft-context'
import {
  createEnvironmentFormSchema,
  environmentFormDefaults,
  type EnvironmentFormValues,
} from '../environment-form'
import { environmentService, isEnvironmentReadOnly } from '../environment-service'

export function useEnvironmentEditor(detail?: EnvironmentDetails) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const {
    kernels,
    proxies,
    environments,
    refresh,
    setNotice,
    loading,
    configurationError,
    upsertEnvironment,
  } = useAppData()
  const { drafts, setResumeId, setSavedId } = useEnvironmentDrafts()
  const key = detail?.id ?? 'new'
  const [draft] = useState(() => drafts.get(key))
  const [defaults] = useState(() => draft?.defaults ?? environmentFormDefaults(detail))
  const form = useForm<EnvironmentFormValues>({
    defaultValues: defaults,
    resolver: zodResolver(createEnvironmentFormSchema(t)),
    shouldFocusError: false,
  })
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string>()
  const [stopOpen, setStopOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const busy = useRef(false)
  const allowLeave = useRef(false)
  const status = environments.find((item) => item.id === detail?.id)?.status ?? detail?.status
  const readOnly = status ? isEnvironmentReadOnly(status) : false
  const disabled =
    !!configurationError || readOnly || form.formState.isSubmitting || stopping || loading
  useEffect(() => {
    if (draft) form.reset(draft.values, { keepDefaultValues: true })
  }, [draft, form])
  const blocker = useBlocker({
    shouldBlockFn: () => !allowLeave.current && (form.formState.isDirty || busy.current),
    enableBeforeUnload: () => !allowLeave.current && (form.formState.isDirty || busy.current),
    withResolver: true,
  })
  const focusErrors = (errors: FieldErrors<EnvironmentFormValues>) => {
    const names: (keyof EnvironmentFormValues)[] = [
      'name',
      'kernelId',
      'proxyId',
      'language',
      'timezone',
      'width',
      'height',
    ]
    const first = names.find((name) => errors[name])
    if (['language', 'timezone', 'width', 'height'].some((name) => name in errors))
      setExpanded(true)
    if (first) requestAnimationFrame(() => form.setFocus(first))
  }
  const clearDraft = () => {
    drafts.delete(key)
    setResumeId(undefined)
  }
  const submit = form.handleSubmit(async (values) => {
    if (busy.current || readOnly || stopping || loading || configurationError) return
    if (
      !detail &&
      !kernels.some((kernel) => kernel.id === values.kernelId && kernel.status === 'available')
    ) {
      form.setError('kernelId', { message: t('env.kernelRequired') }, { shouldFocus: true })
      return
    }
    if (
      values.connection === 'proxy' &&
      !proxies.some((proxy) => proxy.proxyId === values.proxyId)
    ) {
      form.setError('proxyId', { message: t('env.proxyRequired') }, { shouldFocus: true })
      return
    }
    busy.current = true
    setError(undefined)
    try {
      const saved = await environmentService.save(values, detail?.id)
      upsertEnvironment(saved)
      clearDraft()
      setSavedId(saved.id)
      form.reset(values)
      allowLeave.current = true
      await refresh()
      setNotice({ kind: 'success', message: t(detail ? 'env.saved' : 'env.created') })
      await navigate({ to: '/environments' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('env.operationError'))
    } finally {
      busy.current = false
      allowLeave.current = false
    }
  }, focusErrors)
  const stop = async () => {
    if (!detail || busy.current) return
    busy.current = true
    setStopping(true)
    setError(undefined)
    try {
      const stopped =
        status === 'needs-recovery'
          ? await environmentService.recover(detail.id)
          : await environmentService.stop(detail.id)
      upsertEnvironment(stopped)
      await refresh()
      setStopOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('env.operationError'))
      setStopOpen(false)
    } finally {
      busy.current = false
      setStopping(false)
    }
  }
  const manage = async (destination: '/kernels' | '/proxies') => {
    if (busy.current || disabled) return
    drafts.set(key, { values: form.getValues(), defaults })
    setResumeId(key)
    allowLeave.current = true
    try {
      await navigate({ to: destination })
    } finally {
      allowLeave.current = false
    }
  }
  const discard = () => {
    if (busy.current) return
    clearDraft()
    blocker.proceed?.()
  }
  return {
    form,
    kernels,
    proxies,
    submit,
    expanded,
    setExpanded,
    disabled,
    readOnly,
    status,
    error: error ?? configurationError,
    retryConfiguration: configurationError ? refresh : undefined,
    stopOpen,
    setStopOpen,
    stopping,
    stop,
    blocker,
    discard,
    manage,
    back: () => {
      if (!form.formState.isDirty) clearDraft()
      return navigate({ to: '/environments' })
    },
  }
}
