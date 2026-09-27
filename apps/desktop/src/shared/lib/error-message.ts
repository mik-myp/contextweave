import { batchMessages as zhBatch } from '@/i18n/locales/zh-CN-batches'
import { batchMessages as enBatch } from '@/i18n/locales/en-US-batches'
import { lifecycleMessages as zh } from '@/i18n/locales/zh-CN-lifecycle'
import { lifecycleMessages as en } from '@/i18n/locales/en-US-lifecycle'
const zhMessages = { ...zh, ...zhBatch }
const enMessages = { ...en, ...enBatch }
export function errorMessage(code: string, fallback?: string): string {
  const messages =
    typeof document !== 'undefined' && document.documentElement.lang === 'en-US'
      ? enMessages
      : zhMessages
  const key = `error.${code}`
  return key in messages
    ? messages[key as keyof typeof messages]
    : (fallback ?? messages['error.COMMAND_FAILED'])
}
