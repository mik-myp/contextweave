import type { ThemeRadius } from '@contextweave/contracts'

// Numeric labels, previews, and the applied base radius must describe the same value.
export const themeRadiusValues = {
  default: '0.625rem',
  none: '0rem',
  sm: '0.3rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1.0rem',
} as const satisfies Record<ThemeRadius, `${number}rem`>
