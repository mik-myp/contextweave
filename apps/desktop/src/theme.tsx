/* eslint-disable react-refresh/only-export-components -- the theme module intentionally exports its provider and hooks together. */
import * as React from 'react'
import {
  defaultThemeConfig,
  type ThemeConfig,
  type ThemeDensity,
  type ThemeFont,
  type ThemeMode,
  type ThemePreset,
  type ThemeRadius,
} from '@contextweave/contracts'

type ThemeTokens = Record<string, string>

const presetTokens: Record<ThemePreset, { light: ThemeTokens; dark: ThemeTokens }> = {
  'signal-weave': {
    light: {
      background: 'oklch(0.985 0.008 220)',
      foreground: 'oklch(0.19 0.025 230)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.19 0.025 230)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.19 0.025 230)',
      primary: 'oklch(0.49 0.16 229)',
      'primary-foreground': 'oklch(0.98 0.01 220)',
      secondary: 'oklch(0.94 0.025 210)',
      'secondary-foreground': 'oklch(0.27 0.04 230)',
      muted: 'oklch(0.94 0.02 220)',
      'muted-foreground': 'oklch(0.49 0.04 230)',
      accent: 'oklch(0.91 0.06 190)',
      'accent-foreground': 'oklch(0.25 0.06 210)',
      destructive: 'oklch(0.59 0.2 25)',
      border: 'oklch(0.88 0.03 220)',
      input: 'oklch(0.88 0.03 220)',
      ring: 'oklch(0.55 0.13 220)',
      'chart-1': 'oklch(0.56 0.16 229)',
      'chart-2': 'oklch(0.65 0.13 180)',
      'chart-3': 'oklch(0.64 0.17 80)',
      'chart-4': 'oklch(0.61 0.19 330)',
      'chart-5': 'oklch(0.48 0.12 280)',
      sidebar: 'oklch(0.965 0.018 220)',
      'sidebar-foreground': 'oklch(0.19 0.025 230)',
      'sidebar-primary': 'oklch(0.49 0.16 229)',
      'sidebar-primary-foreground': 'oklch(0.98 0.01 220)',
      'sidebar-accent': 'oklch(0.91 0.06 190)',
      'sidebar-accent-foreground': 'oklch(0.25 0.06 210)',
      'sidebar-border': 'oklch(0.88 0.03 220)',
      'sidebar-ring': 'oklch(0.55 0.13 220)',
    },
    dark: {
      background: 'oklch(0.16 0.025 230)',
      foreground: 'oklch(0.95 0.015 220)',
      card: 'oklch(0.205 0.03 230)',
      'card-foreground': 'oklch(0.95 0.015 220)',
      popover: 'oklch(0.205 0.03 230)',
      'popover-foreground': 'oklch(0.95 0.015 220)',
      primary: 'oklch(0.72 0.14 205)',
      'primary-foreground': 'oklch(0.17 0.03 230)',
      secondary: 'oklch(0.27 0.035 230)',
      'secondary-foreground': 'oklch(0.95 0.015 220)',
      muted: 'oklch(0.27 0.035 230)',
      'muted-foreground': 'oklch(0.71 0.035 220)',
      accent: 'oklch(0.31 0.07 190)',
      'accent-foreground': 'oklch(0.9 0.04 190)',
      destructive: 'oklch(0.7 0.18 25)',
      border: 'oklch(1 0 0 / 12%)',
      input: 'oklch(1 0 0 / 15%)',
      ring: 'oklch(0.62 0.12 205)',
      'chart-1': 'oklch(0.72 0.14 205)',
      'chart-2': 'oklch(0.7 0.14 165)',
      'chart-3': 'oklch(0.75 0.15 85)',
      'chart-4': 'oklch(0.7 0.16 330)',
      'chart-5': 'oklch(0.7 0.13 280)',
      sidebar: 'oklch(0.19 0.03 230)',
      'sidebar-foreground': 'oklch(0.95 0.015 220)',
      'sidebar-primary': 'oklch(0.72 0.14 205)',
      'sidebar-primary-foreground': 'oklch(0.17 0.03 230)',
      'sidebar-accent': 'oklch(0.31 0.07 190)',
      'sidebar-accent-foreground': 'oklch(0.9 0.04 190)',
      'sidebar-border': 'oklch(1 0 0 / 12%)',
      'sidebar-ring': 'oklch(0.62 0.12 205)',
    },
  },
  graphite: {
    light: {
      background: 'oklch(0.985 0 0)',
      foreground: 'oklch(0.17 0 0)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.17 0 0)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.17 0 0)',
      primary: 'oklch(0.3 0 0)',
      'primary-foreground': 'oklch(0.98 0 0)',
      secondary: 'oklch(0.94 0 0)',
      'secondary-foreground': 'oklch(0.25 0 0)',
      muted: 'oklch(0.94 0 0)',
      'muted-foreground': 'oklch(0.48 0 0)',
      accent: 'oklch(0.91 0 0)',
      'accent-foreground': 'oklch(0.25 0 0)',
      destructive: 'oklch(0.59 0.2 25)',
      border: 'oklch(0.88 0 0)',
      input: 'oklch(0.88 0 0)',
      ring: 'oklch(0.55 0 0)',
      'chart-1': 'oklch(0.5 0 0)',
      'chart-2': 'oklch(0.62 0 0)',
      'chart-3': 'oklch(0.72 0 0)',
      'chart-4': 'oklch(0.4 0 0)',
      'chart-5': 'oklch(0.3 0 0)',
      sidebar: 'oklch(0.96 0 0)',
      'sidebar-foreground': 'oklch(0.17 0 0)',
      'sidebar-primary': 'oklch(0.3 0 0)',
      'sidebar-primary-foreground': 'oklch(0.98 0 0)',
      'sidebar-accent': 'oklch(0.91 0 0)',
      'sidebar-accent-foreground': 'oklch(0.25 0 0)',
      'sidebar-border': 'oklch(0.88 0 0)',
      'sidebar-ring': 'oklch(0.55 0 0)',
    },
    dark: {
      background: 'oklch(0.16 0 0)',
      foreground: 'oklch(0.95 0 0)',
      card: 'oklch(0.21 0 0)',
      'card-foreground': 'oklch(0.95 0 0)',
      popover: 'oklch(0.21 0 0)',
      'popover-foreground': 'oklch(0.95 0 0)',
      primary: 'oklch(0.9 0 0)',
      'primary-foreground': 'oklch(0.2 0 0)',
      secondary: 'oklch(0.28 0 0)',
      'secondary-foreground': 'oklch(0.95 0 0)',
      muted: 'oklch(0.28 0 0)',
      'muted-foreground': 'oklch(0.7 0 0)',
      accent: 'oklch(0.33 0 0)',
      'accent-foreground': 'oklch(0.95 0 0)',
      destructive: 'oklch(0.7 0.18 25)',
      border: 'oklch(1 0 0 / 12%)',
      input: 'oklch(1 0 0 / 15%)',
      ring: 'oklch(0.65 0 0)',
      'chart-1': 'oklch(0.9 0 0)',
      'chart-2': 'oklch(0.7 0 0)',
      'chart-3': 'oklch(0.55 0 0)',
      'chart-4': 'oklch(0.4 0 0)',
      'chart-5': 'oklch(0.3 0 0)',
      sidebar: 'oklch(0.2 0 0)',
      'sidebar-foreground': 'oklch(0.95 0 0)',
      'sidebar-primary': 'oklch(0.9 0 0)',
      'sidebar-primary-foreground': 'oklch(0.2 0 0)',
      'sidebar-accent': 'oklch(0.33 0 0)',
      'sidebar-accent-foreground': 'oklch(0.95 0 0)',
      'sidebar-border': 'oklch(1 0 0 / 12%)',
      'sidebar-ring': 'oklch(0.65 0 0)',
    },
  },
  ocean: {
    light: {
      background: 'oklch(0.98 0.015 250)',
      foreground: 'oklch(0.2 0.04 255)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.2 0.04 255)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.2 0.04 255)',
      primary: 'oklch(0.5 0.19 255)',
      'primary-foreground': 'oklch(0.98 0.01 255)',
      secondary: 'oklch(0.93 0.04 250)',
      'secondary-foreground': 'oklch(0.3 0.06 255)',
      muted: 'oklch(0.93 0.03 250)',
      'muted-foreground': 'oklch(0.48 0.06 255)',
      accent: 'oklch(0.89 0.08 220)',
      'accent-foreground': 'oklch(0.28 0.07 245)',
      destructive: 'oklch(0.59 0.2 25)',
      border: 'oklch(0.88 0.04 250)',
      input: 'oklch(0.88 0.04 250)',
      ring: 'oklch(0.58 0.15 255)',
      'chart-1': 'oklch(0.57 0.2 255)',
      'chart-2': 'oklch(0.6 0.15 210)',
      'chart-3': 'oklch(0.67 0.14 170)',
      'chart-4': 'oklch(0.7 0.15 90)',
      'chart-5': 'oklch(0.56 0.17 320)',
      sidebar: 'oklch(0.95 0.025 250)',
      'sidebar-foreground': 'oklch(0.2 0.04 255)',
      'sidebar-primary': 'oklch(0.5 0.19 255)',
      'sidebar-primary-foreground': 'oklch(0.98 0.01 255)',
      'sidebar-accent': 'oklch(0.89 0.08 220)',
      'sidebar-accent-foreground': 'oklch(0.28 0.07 245)',
      'sidebar-border': 'oklch(0.88 0.04 250)',
      'sidebar-ring': 'oklch(0.58 0.15 255)',
    },
    dark: {
      background: 'oklch(0.15 0.04 255)',
      foreground: 'oklch(0.95 0.02 250)',
      card: 'oklch(0.2 0.05 255)',
      'card-foreground': 'oklch(0.95 0.02 250)',
      popover: 'oklch(0.2 0.05 255)',
      'popover-foreground': 'oklch(0.95 0.02 250)',
      primary: 'oklch(0.72 0.17 235)',
      'primary-foreground': 'oklch(0.16 0.04 255)',
      secondary: 'oklch(0.27 0.06 255)',
      'secondary-foreground': 'oklch(0.95 0.02 250)',
      muted: 'oklch(0.27 0.06 255)',
      'muted-foreground': 'oklch(0.71 0.05 250)',
      accent: 'oklch(0.31 0.1 220)',
      'accent-foreground': 'oklch(0.9 0.06 220)',
      destructive: 'oklch(0.7 0.18 25)',
      border: 'oklch(1 0 0 / 12%)',
      input: 'oklch(1 0 0 / 15%)',
      ring: 'oklch(0.67 0.15 235)',
      'chart-1': 'oklch(0.72 0.17 235)',
      'chart-2': 'oklch(0.7 0.14 200)',
      'chart-3': 'oklch(0.72 0.15 165)',
      'chart-4': 'oklch(0.75 0.15 90)',
      'chart-5': 'oklch(0.73 0.16 320)',
      sidebar: 'oklch(0.18 0.05 255)',
      'sidebar-foreground': 'oklch(0.95 0.02 250)',
      'sidebar-primary': 'oklch(0.72 0.17 235)',
      'sidebar-primary-foreground': 'oklch(0.16 0.04 255)',
      'sidebar-accent': 'oklch(0.31 0.1 220)',
      'sidebar-accent-foreground': 'oklch(0.9 0.06 220)',
      'sidebar-border': 'oklch(1 0 0 / 12%)',
      'sidebar-ring': 'oklch(0.67 0.15 235)',
    },
  },
  amber: {
    light: {
      background: 'oklch(0.99 0.012 90)',
      foreground: 'oklch(0.23 0.04 75)',
      card: 'oklch(1 0 0)',
      'card-foreground': 'oklch(0.23 0.04 75)',
      popover: 'oklch(1 0 0)',
      'popover-foreground': 'oklch(0.23 0.04 75)',
      primary: 'oklch(0.62 0.17 65)',
      'primary-foreground': 'oklch(0.98 0.02 90)',
      secondary: 'oklch(0.95 0.04 85)',
      'secondary-foreground': 'oklch(0.3 0.06 75)',
      muted: 'oklch(0.95 0.035 85)',
      'muted-foreground': 'oklch(0.5 0.06 75)',
      accent: 'oklch(0.9 0.09 100)',
      'accent-foreground': 'oklch(0.3 0.07 75)',
      destructive: 'oklch(0.59 0.2 25)',
      border: 'oklch(0.89 0.04 85)',
      input: 'oklch(0.89 0.04 85)',
      ring: 'oklch(0.63 0.15 65)',
      'chart-1': 'oklch(0.65 0.18 65)',
      'chart-2': 'oklch(0.65 0.14 120)',
      'chart-3': 'oklch(0.6 0.14 200)',
      'chart-4': 'oklch(0.64 0.17 330)',
      'chart-5': 'oklch(0.54 0.15 280)',
      sidebar: 'oklch(0.97 0.025 90)',
      'sidebar-foreground': 'oklch(0.23 0.04 75)',
      'sidebar-primary': 'oklch(0.62 0.17 65)',
      'sidebar-primary-foreground': 'oklch(0.98 0.02 90)',
      'sidebar-accent': 'oklch(0.9 0.09 100)',
      'sidebar-accent-foreground': 'oklch(0.3 0.07 75)',
      'sidebar-border': 'oklch(0.89 0.04 85)',
      'sidebar-ring': 'oklch(0.63 0.15 65)',
    },
    dark: {
      background: 'oklch(0.17 0.035 75)',
      foreground: 'oklch(0.96 0.025 90)',
      card: 'oklch(0.22 0.045 75)',
      'card-foreground': 'oklch(0.96 0.025 90)',
      popover: 'oklch(0.22 0.045 75)',
      'popover-foreground': 'oklch(0.96 0.025 90)',
      primary: 'oklch(0.78 0.16 80)',
      'primary-foreground': 'oklch(0.2 0.04 75)',
      secondary: 'oklch(0.3 0.06 75)',
      'secondary-foreground': 'oklch(0.96 0.025 90)',
      muted: 'oklch(0.3 0.06 75)',
      'muted-foreground': 'oklch(0.74 0.05 90)',
      accent: 'oklch(0.35 0.1 95)',
      'accent-foreground': 'oklch(0.92 0.08 100)',
      destructive: 'oklch(0.7 0.18 25)',
      border: 'oklch(1 0 0 / 12%)',
      input: 'oklch(1 0 0 / 15%)',
      ring: 'oklch(0.7 0.14 80)',
      'chart-1': 'oklch(0.78 0.16 80)',
      'chart-2': 'oklch(0.72 0.14 130)',
      'chart-3': 'oklch(0.7 0.14 210)',
      'chart-4': 'oklch(0.72 0.16 330)',
      'chart-5': 'oklch(0.73 0.14 280)',
      sidebar: 'oklch(0.2 0.045 75)',
      'sidebar-foreground': 'oklch(0.96 0.025 90)',
      'sidebar-primary': 'oklch(0.78 0.16 80)',
      'sidebar-primary-foreground': 'oklch(0.2 0.04 75)',
      'sidebar-accent': 'oklch(0.35 0.1 95)',
      'sidebar-accent-foreground': 'oklch(0.92 0.08 100)',
      'sidebar-border': 'oklch(1 0 0 / 12%)',
      'sidebar-ring': 'oklch(0.7 0.14 80)',
    },
  },
}

const radiusValues: Record<ThemeRadius, string> = {
  none: '0rem',
  sm: '0.375rem',
  md: '0.625rem',
  lg: '0.875rem',
  xl: '1.125rem',
}
const densityValues: Record<ThemeDensity, string> = {
  compact: '0.85',
  comfortable: '1',
  spacious: '1.15',
}
const fontValues: Record<ThemeFont, string> = {
  geist: "'Geist Variable', sans-serif",
  system: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

function resolvedMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(config: ThemeConfig): void {
  const root = document.documentElement
  const mode = resolvedMode(config.mode)
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('light', mode === 'light')
  root.dataset.themeMode = config.mode
  root.dataset.themePreset = config.preset
  root.dataset.themeRadius = config.radius
  root.dataset.themeDensity = config.density
  root.dataset.themeFont = config.font
  root.dataset.sidebarLayout = config.sidebarLayout
  root.style.setProperty('--radius', radiusValues[config.radius])
  root.style.setProperty('--density-scale', densityValues[config.density])
  root.style.setProperty('--spacing', `calc(0.25rem * ${densityValues[config.density]})`)
  root.style.setProperty('--font-sans', fontValues[config.font])
  root.style.setProperty('--font-heading', fontValues[config.font])
  const tokens = presetTokens[config.preset][mode]
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value)
}

type ThemeContextValue = {
  theme: ThemeConfig
  setTheme: (patch: Partial<ThemeConfig>) => void
  resetTheme: () => void
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
  const initialized = React.useRef(false)

  React.useEffect(() => {
    applyTheme(theme)
    initialized.current = true
  }, [theme])

  React.useEffect(() => {
    if (!initialized.current) return
    void window.contextweave?.settings.setTheme(theme)
  }, [theme])

  React.useEffect(() => {
    if (theme.mode !== 'system') return
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const listener = () => applyTheme(theme)
    media.addEventListener?.('change', listener)
    return () => media.removeEventListener?.('change', listener)
  }, [theme])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (patch) => setThemeState((current) => ({ ...current, ...patch, version: 1 })),
      resetTheme: () => setThemeState(defaultThemeConfig),
    }),
    [theme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}

export { presetTokens }
