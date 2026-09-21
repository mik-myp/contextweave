// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme } from './theme'
import { defaultThemeConfig } from '@contextweave/contracts'

describe('theme application', () => {
  beforeEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
  })

  it('applies preset, radius, density, font and sidebar attributes', () => {
    applyTheme({
      ...defaultThemeConfig,
      mode: 'dark',
      preset: 'ocean',
      radius: 'xl',
      density: 'compact',
      font: 'mono',
      sidebarLayout: 'floating',
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.themePreset).toBe('ocean')
    expect(document.documentElement.dataset.sidebarLayout).toBe('floating')
    expect(document.documentElement.style.getPropertyValue('--radius')).toBe('1.125rem')
    expect(document.documentElement.style.getPropertyValue('--density-scale')).toBe('0.85')
  })

  it('resolves system mode from the browser preference', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    })
    applyTheme(defaultThemeConfig)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
