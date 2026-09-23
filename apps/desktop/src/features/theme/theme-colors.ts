import { clampChroma, converter, formatCss, wcagContrast } from 'culori'
import { defaultThemeConfig, themeColorSchema } from '@contextweave/contracts'

type ThemeTokens = Record<string, string>
type Mode = 'light' | 'dark'
type Oklch = { mode: 'oklch'; l: number; c: number; h: number }

const toOklch = converter('oklch')
// Leave room for serialization and display rounding above the 4.5 / 3 minimums.
const TEXT_CONTRAST = 4.6
const GRAPHIC_CONTRAST = 3.1
const neutral: Oklch = { mode: 'oklch', l: 0.5, c: 0, h: 0 }

function seedColor(value: string): Oklch {
  const input = themeColorSchema.safeParse(value)
  const parsed = toOklch(input.success ? input.data : defaultThemeConfig.color)!
  const chroma = Math.min(parsed.c, 0.28)
  return {
    mode: 'oklch',
    l: parsed.l,
    // Numerical residue from converting gray must not introduce a hue.
    c: chroma < 0.002 ? 0 : chroma,
    h: parsed.h ?? 0,
  }
}

function tone(seed: Oklch, lightness: number, chroma = seed.c): string {
  const color = clampChroma(
    { mode: 'oklch', l: Math.max(0, Math.min(1, lightness)), c: chroma, h: seed.h },
    'oklch',
    'rgb',
  )
  return formatCss(color)!
}

function contrastingTone(
  seed: Oklch,
  lightness: number,
  chroma: number,
  surfaces: string[],
  minimum: number,
  mode: Mode,
): string {
  const passes = (color: string) =>
    surfaces.every((surface) => wcagContrast(color, surface) >= minimum)
  const initial = tone(seed, lightness, chroma)
  if (passes(initial)) return initial

  // Search only toward the contrasting endpoint, preserving the seed hue.
  let failing = lightness
  let passing = mode === 'light' ? 0 : 1
  for (let step = 0; step < 18; step++) {
    const middle = (failing + passing) / 2
    if (passes(tone(seed, middle, chroma))) passing = middle
    else failing = middle
  }
  return tone(seed, passing, chroma)
}

function readableForeground(background: string): string {
  if (wcagContrast(background, '#171717') >= TEXT_CONTRAST) return '#171717'
  if (wcagContrast(background, '#FFFFFF') >= TEXT_CONTRAST) return '#FFFFFF'
  // Off-black and white have a contrast gap; true black closes it.
  return wcagContrast(background, '#000000') >= wcagContrast(background, '#FFFFFF')
    ? '#000000'
    : '#FFFFFF'
}

function statusColors(mode: Mode): ThemeTokens {
  const definitions = {
    destructive: [0.22, 25],
    warning: [0.18, 75],
    success: [0.16, 150],
    info: [0.15, 230],
  }
  const tokens: ThemeTokens = {}
  // Fixed conservative surfaces keep semantic colors independent of the user's seed.
  const surface = mode === 'light' ? 'oklch(0.9 0 0)' : 'oklch(0.36 0 0)'
  for (const [name, [chroma, hue]] of Object.entries(definitions)) {
    const seed: Oklch = { mode: 'oklch', l: 0.5, c: chroma, h: hue }
    const color = contrastingTone(
      seed,
      mode === 'light' ? 0.5 : 0.78,
      chroma,
      [surface],
      TEXT_CONTRAST,
      mode,
    )
    tokens[name] = color
    tokens[name + '-foreground'] = readableForeground(color)
    tokens[name + '-muted'] = tone(seed, mode === 'light' ? 0.96 : 0.27, chroma * 0.15)
    tokens[name + '-muted-hover'] = tone(seed, mode === 'light' ? 0.92 : 0.32, chroma * 0.24)
  }
  return tokens
}

export function deriveThemeTokens(hex: string, mode: Mode): ThemeTokens {
  const seed = seedColor(hex)
  const chroma = seed.c
  const isLight = mode === 'light'
  const accent = tone(seed, isLight ? 0.95 : 0.28, chroma * (isLight ? 0.14 : 0.24))
  const background = tone(neutral, isLight ? 1 : 0.145)
  const foreground = tone(neutral, isLight ? 0.205 : 0.97)
  const card = tone(neutral, isLight ? 1 : 0.205)
  const muted = tone(neutral, isLight ? 0.965 : 0.269)
  const sidebar = tone(neutral, isLight ? 0.985 : 0.18)
  const surfaces = [background, card, muted, accent, sidebar]
  const primaryChroma = chroma * (isLight ? 1 : 0.82)
  const primary = contrastingTone(
    seed,
    isLight ? 0.52 : 0.72,
    primaryChroma,
    surfaces,
    TEXT_CONTRAST,
    mode,
  )
  const primaryHover = tone(seed, toOklch(primary)!.l + (isLight ? -0.04 : 0.04), primaryChroma)
  // Quiet structural borders match the admin surfaces; focus retains a contrast-safe ring.
  const border = tone(neutral, isLight ? 0.91 : 0.33)
  const input = border
  const primaryForeground = readableForeground(primary)
  const accentForeground = readableForeground(accent)

  // Bound the whole ramp before spacing its steps; clamping each step would merge tones.
  const chartEnd = toOklch(
    contrastingTone(
      seed,
      isLight ? 0.82 : 0.42,
      chroma * 0.47,
      [background, card],
      GRAPHIC_CONTRAST,
      mode,
    ),
  )!.l
  const chartStart = isLight ? 0.42 : 0.82
  const chart = [0, 1, 2, 3, 4].map((index) =>
    tone(seed, chartStart + ((chartEnd - chartStart) * index) / 4, chroma * (0.95 - index * 0.12)),
  )

  return {
    background,
    foreground,
    card,
    'card-foreground': foreground,
    popover: card,
    'popover-foreground': foreground,
    primary,
    'primary-hover': primaryHover,
    'primary-foreground': primaryForeground,
    secondary: muted,
    'secondary-foreground': foreground,
    muted,
    'muted-foreground': tone(neutral, isLight ? 0.49 : 0.73),
    accent,
    'accent-foreground': accentForeground,
    ...statusColors(mode),
    border,
    input,
    ring: primary,
    overlay: isLight ? 'oklch(0.1 0 0 / 24%)' : 'oklch(0 0 0 / 55%)',
    'chart-1': chart[0],
    'chart-2': chart[1],
    'chart-3': chart[2],
    'chart-4': chart[3],
    'chart-5': chart[4],
    sidebar,
    'sidebar-foreground': foreground,
    'sidebar-primary': primary,
    'sidebar-primary-foreground': primaryForeground,
    'sidebar-accent': accent,
    'sidebar-accent-foreground': accentForeground,
    'sidebar-border': border,
    'sidebar-ring': primary,
  }
}
