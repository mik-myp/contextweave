import { beforeAll, describe, expect, it } from 'vitest'
import { converter, displayable, wcagContrast, type Rgb } from 'culori'
import { defaultThemeConfig } from '@contextweave/contracts'
import { deriveThemeTokens } from './theme-colors'

const toRgb = converter('rgb')
const toOklch = converter('oklch')
const modes = ['light', 'dark'] as const
const surfaces = ['background', 'card', 'popover', 'muted', 'accent', 'sidebar']
const statuses = ['destructive', 'warning', 'success', 'info']

function sampleColors(): string[] {
  const hex = (...channels: number[]) =>
    '#' + channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')
  const seeds = new Set([
    '#2563EB',
    '#0891B2',
    '#7C3AED',
    '#DB2777',
    '#EA580C',
    '#16A34A',
    '#70BF60',
    '#4020DF',
    '#CFEFDF',
  ])
  for (let gray = 0; gray < 256; gray++) seeds.add(hex(gray, gray, gray))
  const levels = [0, 1, 16, 64, 128, 192, 239, 254, 255]
  for (const r of levels) for (const g of levels) for (const b of levels) seeds.add(hex(r, g, b))
  return [...seeds]
}

// Evaluate rendered sRGB channels, including alpha composition and 8-bit rounding.
function composite(foreground: string, background: string, opacity = 1): Rgb {
  const fg = toRgb(foreground)!
  const bg = toRgb(background)!
  const alpha = (fg.alpha ?? 1) * opacity
  const channel = (a: number, b: number) => Math.round((a * alpha + b * (1 - alpha)) * 255) / 255
  return { mode: 'rgb', r: channel(fg.r, bg.r), g: channel(fg.g, bg.g), b: channel(fg.b, bg.b) }
}

type Palette = { seed: string; tokens: ReturnType<typeof deriveThemeTokens> }
function expectContrast(palettes: Palette[], pairs: string[][], minimum: number): void {
  for (const [foreground, background] of pairs) {
    let worst = { contrast: Infinity, seed: '' }
    for (const { seed, tokens } of palettes) {
      const ratio = wcagContrast(
        composite(tokens[foreground], tokens[background]),
        composite(tokens[background], tokens[background]),
      )
      if (ratio < worst.contrast) worst = { contrast: ratio, seed }
    }
    expect(
      worst.contrast,
      worst.seed + ': ' + foreground + ' on ' + background,
    ).toBeGreaterThanOrEqual(minimum)
  }
}

describe('theme color input', () => {
  it.each(modes)(
    'falls back to the default for anything except opaque six-digit HEX in %s mode',
    (mode) => {
      const fallback = deriveThemeTokens(defaultThemeConfig.color, mode)
      for (const value of [
        'not-a-color',
        '',
        '#fff',
        '#FFFFFFFF',
        '#00000000',
        'transparent',
        'red',
        'oklch(none none none)',
        'oklch(1e999 .2 30)',
        '#12GG00',
      ]) {
        expect(deriveThemeTokens(value, mode), value).toEqual(fallback)
      }
      expect(deriveThemeTokens('#abcdef', mode)).toEqual(deriveThemeTokens('#ABCDEF', mode))
    },
  )
})

describe.each(modes)('custom theme colors in %s mode', (mode) => {
  let palettes: Palette[]
  // The full gamut sweep needs more time on shared Intel runners; keep every sample and assertion.
  beforeAll(() => {
    palettes = sampleColors().map((seed) => ({ seed, tokens: deriveThemeTokens(seed, mode) }))
  }, 30000)

  it('keeps neutral surfaces, text and structural borders independent of the accent', () => {
    const baseline = deriveThemeTokens(defaultThemeConfig.color, mode)
    const neutralRoles = [
      'background',
      'foreground',
      'card',
      'popover',
      'muted',
      'muted-foreground',
      'secondary',
      'sidebar',
      'border',
      'input',
    ]
    for (const { seed, tokens } of palettes) {
      expect(tokens.input).toBe(tokens.border)
      for (const role of neutralRoles) {
        expect(tokens[role], seed + ':' + role).toBe(baseline[role])
        expect(toOklch(tokens[role])!.c).toBeLessThan(0.002)
      }
    }
    const otherAccent = deriveThemeTokens('#DB2777', mode)
    for (const role of ['primary', 'accent', 'ring', 'sidebar-accent', 'chart-1'])
      expect(otherAccent[role], role).not.toBe(baseline[role])
  })

  it('emits finite sRGB colors for every token, including semantic status colors', () => {
    const invalidTokens: string[] = []
    // Check the complete sample set without allocating an assertion for every channel.
    for (const { seed, tokens } of palettes) {
      for (const [name, value] of Object.entries(tokens)) {
        const rgb = toRgb(value)
        const expectedAlpha = name === 'overlay' ? (mode === 'light' ? 0.24 : 0.55) : 1
        if (
          !rgb ||
          ![rgb.r, rgb.g, rgb.b].every(Number.isFinite) ||
          !displayable(value) ||
          (rgb.alpha ?? 1) !== expectedAlpha
        ) {
          invalidTokens.push(seed + ':' + name + '=' + value)
        }
      }
    }
    expect(invalidTokens).toEqual([])
  })

  it('keeps foregrounds readable on supported surfaces and opaque hover states', () => {
    expectContrast(
      palettes,
      [
        ['foreground', 'background'],
        ['card-foreground', 'card'],
        ['popover-foreground', 'popover'],
        ['primary-foreground', 'primary'],
        ['primary-foreground', 'primary-hover'],
        ['secondary-foreground', 'secondary'],
        ['muted-foreground', 'muted'],
        ['accent-foreground', 'accent'],
        ['sidebar-foreground', 'sidebar'],
        ['sidebar-primary-foreground', 'sidebar-primary'],
        ['sidebar-accent-foreground', 'sidebar-accent'],
        ...statuses.flatMap((status) => [
          [status, status + '-muted'],
          [status, status + '-muted-hover'],
        ]),
        ...statuses.map((status) => [status + '-foreground', status]),
        ...surfaces.flatMap((surface) =>
          ['foreground', 'muted-foreground', 'primary', ...statuses].map((text) => [text, surface]),
        ),
      ],
      4.5,
    )
  })

  it('keeps focus indicators and chart marks distinguishable', () => {
    expectContrast(
      palettes,
      [
        ...surfaces.flatMap((surface) => ['ring'].map((indicator) => [indicator, surface])),
        ...['background', 'card'].flatMap((surface) =>
          [1, 2, 3, 4, 5].map((index) => ['chart-' + index, surface]),
        ),
      ],
      3,
    )
  })

  it('checks the actual tinted control fill and its placeholder, text and focus colors', () => {
    let textMinimum = Infinity
    let boundaryMinimum = Infinity
    for (const { tokens } of palettes) {
      for (const surface of surfaces) {
        for (const opacity of mode === 'dark' ? [0.3, 0.5] : [0, 0.3]) {
          const fill = composite(tokens.muted, tokens[surface], opacity)
          for (const text of ['foreground', 'muted-foreground', 'destructive'])
            textMinimum = Math.min(textMinimum, wcagContrast(toRgb(tokens[text])!, fill))
          for (const boundary of ['ring', 'destructive'])
            boundaryMinimum = Math.min(
              boundaryMinimum,
              wcagContrast(toRgb(tokens[boundary])!, fill),
            )
        }
      }
    }
    expect(textMinimum).toBeGreaterThanOrEqual(4.5)
    expect(boundaryMinimum).toBeGreaterThanOrEqual(3)
  })

  it('retains five distinct, ordered chart tones and the selected hue', () => {
    for (const { seed, tokens } of palettes) {
      const input = toOklch(seed)!
      const tones = [1, 2, 3, 4, 5].map((index) => toOklch(tokens['chart-' + index])!)
      tones.forEach((tone, index) => {
        if (input.c >= 0.002) {
          const delta = Math.abs(tone.h! - input.h!)
          expect(Math.min(delta, 360 - delta), seed).toBeLessThan(1)
        }
        if (index)
          expect((tone.l - tones[index - 1].l) * (mode === 'light' ? 1 : -1), seed).toBeGreaterThan(
            0.02,
          )
      })
    }
  })

  it('keeps all 256 grayscale inputs achromatic without changing status colors', () => {
    const baseline = deriveThemeTokens(defaultThemeConfig.color, mode)
    const semanticTokens = Object.keys(baseline).filter((name) =>
      statuses.some((status) => name.startsWith(status)),
    )
    for (const { seed, tokens } of palettes) {
      for (const name of semanticTokens)
        expect(tokens[name], seed + ':' + name).toBe(baseline[name])
      if (!/^#([\da-f]{2})\1\1$/i.test(seed)) continue
      for (const [name, value] of Object.entries(tokens)) {
        if (!semanticTokens.includes(name))
          expect(toOklch(value)!.c, seed + ':' + name).toBeLessThan(0.002)
      }
    }
  })
})
