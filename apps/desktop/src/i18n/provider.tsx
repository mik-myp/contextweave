/* eslint-disable react-refresh/only-export-components -- provider and hook form one i18n boundary. */
import * as React from 'react'
import { messages } from './locales'
import type { Locale, TranslationKey } from './types'

export type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

function readLocale(): Locale {
  try {
    const value = window.localStorage.getItem('contextweave:locale')
    return value === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() =>
    typeof window === 'undefined' ? 'zh-CN' : readLocale(),
  )
  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem('contextweave:locale', next)
    } catch {
      // Language switching remains available when local storage is unavailable.
    }
  }, [])
  const value = React.useMemo(
    () => ({ locale, setLocale, t: (key: TranslationKey) => messages[locale][key] }),
    [locale, setLocale],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = React.useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
