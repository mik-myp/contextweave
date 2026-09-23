/* eslint-disable react-refresh/only-export-components -- provider and hook form one theme boundary. */
import * as React from 'react'
import { DirectionProvider } from '@base-ui/react/direction-provider'
import { defaultThemeConfig, type ThemeConfig } from '@contextweave/contracts'
import { applyTheme } from './theme-application'
import { createThemePersistence, type ThemeSaveStatus } from './theme-persistence'

type ThemePatch = Partial<Omit<ThemeConfig, 'version'>>
type ThemeContextValue = {
  theme: ThemeConfig
  setTheme: (patch: ThemePatch) => void
  resetTheme: () => void
  saveStatus: ThemeSaveStatus
  retrySave: () => void
}
const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  initialTheme = defaultThemeConfig,
  children,
}: {
  initialTheme?: ThemeConfig
  children: React.ReactNode
}) {
  const [theme, setThemeState] = React.useState<ThemeConfig>(initialTheme)
  const [persistence] = React.useState(() =>
    createThemePersistence(async (config) => {
      const write = window.contextweave?.settings.setTheme
      if (!write) return { ok: false }
      return write(config)
    }),
  )
  const saveStatus = React.useSyncExternalStore(persistence.subscribe, persistence.getSnapshot)
  const lastRequested = React.useRef(theme)

  React.useEffect(() => {
    applyTheme(theme)
    if (lastRequested.current !== theme) {
      lastRequested.current = theme
      void persistence.save(theme)
    }
  }, [theme, persistence])
  React.useEffect(() => {
    if (theme.mode !== 'system') return
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const listener = () => applyTheme(theme)
    media.addEventListener?.('change', listener)
    return () => media.removeEventListener?.('change', listener)
  }, [theme])

  const setTheme = React.useCallback((patch: ThemePatch) => {
    setThemeState((current) =>
      Object.entries(patch).every(([key, value]) => current[key as keyof ThemeConfig] === value)
        ? current
        : { ...current, ...patch, version: 2 },
    )
  }, [])
  const resetTheme = React.useCallback(() => setTheme(defaultThemeConfig), [setTheme])
  const retrySave = React.useCallback(() => {
    void persistence.retry()
  }, [persistence])
  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      resetTheme,
      saveStatus,
      retrySave,
    }),
    [theme, setTheme, resetTheme, saveStatus, retrySave],
  )
  return (
    <ThemeContext.Provider value={value}>
      <DirectionProvider direction={theme.direction}>{children}</DirectionProvider>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
