import type { AppLogEntry } from '@contextweave/contracts'
import type { I18nContextValue } from '@/i18n'
import { errorMessage } from '@/shared/lib/error-message'

type Translate = I18nContextValue['t']

export function describeLogEntry(entry: AppLogEntry, t: Translate) {
  const message = t(`logs.event.${entry.event}`)
  if (entry.event === 'environment-state' && entry.fields.status) {
    return `${message} · ${t(`status.${entry.fields.status}`)}`
  }
  return entry.errorCode
    ? `${message} · ${errorMessage(entry.errorCode, entry.errorCode)}`
    : message
}

export const logLevelVariants = {
  debug: 'secondary',
  info: 'info',
  warn: 'warning',
  error: 'destructive',
} as const
