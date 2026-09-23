import { lifecycleMessages as zh } from '@/i18n/locales/zh-CN-lifecycle'
import { lifecycleMessages as en } from '@/i18n/locales/en-US-lifecycle'
export function errorMessage(code: string, fallback?: string): string {
  const messages =
    typeof document !== 'undefined' && document.documentElement.lang === 'en-US' ? en : zh
  const key = `error.${code}`
  return key in messages
    ? messages[key as keyof typeof messages]
    : (fallback ?? messages['error.COMMAND_FAILED'])
}
