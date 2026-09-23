// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultThemeConfig } from '@contextweave/contracts'
import { applyTheme } from './features/theme/theme-application'

describe('theme application', () => {
  beforeEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
  })

  it('applies color, layout, scale and semantic tokens', () => {
    applyTheme({
      ...defaultThemeConfig,
      mode: 'dark',
      color: '#7C3AED',
      radius: 'xl',
      density: 'compact',
      font: 'serif',
      sidebar: 'floating',
      layout: 'icon',
      contentWidth: 'full',
      direction: 'rtl',
      scale: 110,
      motion: 'reduced',
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.themeColor).toBe('#7C3AED')
    expect(document.documentElement.dataset.sidebar).toBe('floating')
    expect(document.documentElement.dataset.layout).toBe('icon')
    expect(document.documentElement.dataset.scale).toBe('110')
    expect(document.documentElement.dataset.motion).toBe('reduced')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.style.getPropertyValue('--radius')).toBe('1.0rem')
    expect(document.documentElement.style.getPropertyValue('--control-height')).toBe('2rem')
    expect(document.documentElement.style.getPropertyValue('--spacing')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('')
  })

  it('changes density without changing typography, color or layout preferences', () => {
    const config = {
      ...defaultThemeConfig,
      color: '#DB2777',
      font: 'serif' as const,
      scale: 125 as const,
      layout: 'icon' as const,
    }
    applyTheme(config)
    const root = document.documentElement
    const initial = {
      font: root.style.getPropertyValue('--theme-font'),
      primary: root.style.getPropertyValue('--primary'),
      scale: root.style.getPropertyValue('--theme-scale'),
    }
    expect(root.style.getPropertyValue('--control-height')).toBe('2.25rem')
    expect(root.style.getPropertyValue('--control-height-sm')).toBe('2rem')
    for (const density of ['compact', 'default', 'comfortable', 'spacious'] as const) {
      applyTheme({ ...config, density })
      expect(root.style.getPropertyValue('--theme-font')).toBe(initial.font)
      expect(root.style.getPropertyValue('--primary')).toBe(initial.primary)
      expect(root.style.getPropertyValue('--theme-scale')).toBe(initial.scale)
      expect(root.dataset.layout).toBe('icon')
      expect(root.style.getPropertyValue('--spacing')).toBe('')
      expect(root.style.getPropertyValue('--control-height')).not.toBe('')
    }
    expect(root.style.getPropertyValue('--control-height')).toBe('2.75rem')
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
