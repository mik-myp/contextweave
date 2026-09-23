import { z } from 'zod'
import { proxyTypeSchema, proxyHostSchema, type SaveProxyInput } from '@contextweave/contracts'
import type { I18nContextValue } from '@/i18n'

export function proxyFormSchema(t: I18nContextValue['t']) {
  return z
    .object({
      name: z.string().trim().max(80),
      type: proxyTypeSchema,
      host: z
        .string()
        .trim()
        .refine((value) => proxyHostSchema.safeParse(value).success, t('proxy.hostError')),
      port: z
        .string()
        .refine(
          (value) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535,
          t('proxy.portError'),
        ),
      username: z.string().trim(),
      password: z.string(),
      clearPassword: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (values.password && !values.username)
        ctx.addIssue({ code: 'custom', path: ['username'], message: t('proxy.usernameRequired') })
    })
}
export type ProxyFormValues = z.infer<ReturnType<typeof proxyFormSchema>>
export function toSaveProxyInput(values: ProxyFormValues, proxyId?: string): SaveProxyInput {
  return {
    proxyId,
    config: {
      name: values.name.trim(),
      type: values.type,
      host: values.host.trim(),
      port: Number(values.port),
      username: values.username.trim() || undefined,
    },
    password: values.clearPassword ? undefined : values.password || undefined,
    clearPassword: values.clearPassword,
  }
}
