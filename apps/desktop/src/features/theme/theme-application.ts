import type { ThemeConfig, ThemeMode } from '@contextweave/contracts'
import { deriveThemeTokens } from './theme-colors'
import { themeFontFamilies } from './theme-fonts'
import { themeRadiusValues } from './theme-radius'

const densityValues: Record<ThemeConfig['density'], string> = {
  compact: '0.85',
  default: '1',
  comfortable: '1.08',
  spacious: '1.18',
}

export function resolvedMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(config: ThemeConfig): void {
  const root = document.documentElement
  const mode = resolvedMode(config.mode)
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('light', mode === 'light')
  root.dataset.themeMode = config.mode
  root.dataset.themeColor = config.color
  root.dataset.themeRadius = config.radius
  root.dataset.themeDensity = config.density
  root.dataset.themeFont = config.font
  root.dataset.sidebar = config.sidebar
  root.dataset.layout = config.layout
  root.dataset.contentWidth = config.contentWidth
  root.dataset.direction = config.direction
  root.dataset.motion = config.motion
  root.dataset.scale = String(config.scale)
  root.dir = config.direction
  root.style.setProperty('--radius', themeRadiusValues[config.radius])
  root.style.setProperty('--density-scale', densityValues[config.density])
  root.style.setProperty('--spacing', 'calc(0.25rem * ' + densityValues[config.density] + ')')
  root.style.setProperty('--theme-font', themeFontFamilies[config.font])
  root.style.setProperty('--theme-scale', String(config.scale / 100))
  for (const [name, value] of Object.entries(deriveThemeTokens(config.color, mode))) {
    root.style.setProperty('--' + name, value)
  }
}
