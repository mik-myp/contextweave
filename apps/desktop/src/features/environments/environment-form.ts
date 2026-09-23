import { z } from 'zod'
import {
  browserLanguageSchema,
  browserTimezoneSchema,
  defaultCommonEnvironmentConfig,
  type BrowserSettings,
  type CreateEnvironmentInput,
  type EnvironmentDetails,
  type UpdateEnvironmentInput,
} from '@contextweave/contracts'
import type { I18nContextValue } from '@/i18n'

export type EnvironmentFormValues = {
  name: string
  kernelId: string
  connection: 'direct' | 'proxy'
  proxyId: string
  language: string
  timezone: string
  width: number
  height: number
}

export function createEnvironmentFormSchema(t: I18nContextValue['t']) {
  return z
    .object({
      name: z.string().trim().min(1, t('env.nameRequired')).max(80, t('env.nameRequired')),
      kernelId: z.string().min(1, t('env.kernelRequired')),
      connection: z.enum(['direct', 'proxy']),
      proxyId: z.string(),
      language: z
        .string()
        .refine(
          (value) => browserLanguageSchema.safeParse(value).success,
          t('env.languageInvalid'),
        ),
      timezone: z
        .string()
        .refine(
          (value) => browserTimezoneSchema.safeParse(value).success,
          t('env.timezoneInvalid'),
        ),
      width: z
        .number({ error: t('env.widthInvalid') })
        .int(t('env.widthInvalid'))
        .min(640, t('env.widthInvalid'))
        .max(7680, t('env.widthInvalid')),
      height: z
        .number({ error: t('env.heightInvalid') })
        .int(t('env.heightInvalid'))
        .min(480, t('env.heightInvalid'))
        .max(4320, t('env.heightInvalid')),
    })
    .superRefine((value, ctx) => {
      if (value.connection === 'proxy' && !value.proxyId)
        ctx.addIssue({ code: 'custom', path: ['proxyId'], message: t('env.proxyRequired') })
    })
}

export function environmentFormDefaults(detail?: EnvironmentDetails): EnvironmentFormValues {
  return {
    name: detail?.name ?? '',
    kernelId: detail?.kernelId ?? '',
    connection: detail?.proxyId ? 'proxy' : 'direct',
    proxyId: detail?.proxyId ?? '',
    language: detail?.browserSettings.language ?? 'system',
    timezone: detail?.browserSettings.timezone ?? 'system',
    width: detail?.browserSettings.window.width ?? 1440,
    height: detail?.browserSettings.window.height ?? 900,
  }
}

export function formBrowserSettings(values: EnvironmentFormValues): BrowserSettings {
  return {
    language: values.language,
    timezone: values.timezone,
    window: { width: values.width, height: values.height },
  }
}

export function toCreateEnvironmentInput(values: EnvironmentFormValues): CreateEnvironmentInput {
  return {
    name: values.name.trim(),
    kernelId: values.kernelId,
    proxyId: values.connection === 'proxy' ? values.proxyId : undefined,
    commonConfig: { ...defaultCommonEnvironmentConfig, ...formBrowserSettings(values) },
    kernelConfig: {},
  }
}

export function toUpdateEnvironmentInput(
  id: string,
  values: EnvironmentFormValues,
): UpdateEnvironmentInput {
  return {
    version: 1,
    environmentId: id,
    name: values.name.trim(),
    proxyId: values.connection === 'proxy' ? values.proxyId : null,
    browserSettings: formBrowserSettings(values),
  }
}
