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
    expect(document.documentElement.style.getPropertyValue('--density-scale')).toBe('0.85')
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('')
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
