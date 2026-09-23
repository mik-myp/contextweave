import type { ThemeFont } from '@contextweave/contracts'

// Previews and the applied theme share the same explicit stacks; neither inherits a different choice.
export const themeFontFamilies: Record<ThemeFont, string> = {
  default: "'Public Sans Variable', sans-serif",
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
}
