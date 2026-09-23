import { enUSMessages } from './en-US'
import { zhCNMessages } from './zh-CN'
import type { Locale, TranslationKey } from '../types'

export const messages: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
}
