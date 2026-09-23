import type { ThemeDensity } from '@contextweave/contracts'

type DensityMetrics = {
  control: number
  padding: number
  inputPadding: number
  menu: number
  panel: number
  field: number
  section: number
  page: number
  tableCell: number
}

// Density changes the space for each task, independently of type, icons and shell geometry.
const metrics: Record<ThemeDensity, DensityMetrics> = {
  compact: {
    control: 32,
    padding: 12,
    inputPadding: 10,
    menu: 28,
    panel: 16,
    field: 20,
    section: 24,
    page: 16,
    tableCell: 8,
  },
  default: {
    control: 36,
    padding: 16,
    inputPadding: 12,
    menu: 32,
    panel: 24,
    field: 28,
    section: 32,
    page: 24,
    tableCell: 10,
  },
  comfortable: {
    control: 40,
    padding: 18,
    inputPadding: 14,
    menu: 36,
    panel: 28,
    field: 32,
    section: 40,
    page: 28,
    tableCell: 14,
  },
  spacious: {
    control: 44,
    padding: 20,
    inputPadding: 16,
    menu: 40,
    panel: 32,
    field: 36,
    section: 48,
    page: 32,
    tableCell: 16,
  },
}

const rem = (pixels: number) => `${pixels / 16}rem`

export function deriveDensityTokens(density: ThemeDensity): Record<string, string> {
  const value = metrics[density]
  return {
    'control-height': rem(value.control),
    'control-height-sm': rem(value.control - 4),
    'control-height-xs': rem(value.control - 8),
    'control-height-lg': rem(value.control + 4),
    'control-padding': rem(value.padding),
    'control-padding-sm': rem(value.padding - 4),
    'input-padding': rem(value.inputPadding),
    'menu-item-height': rem(value.menu),
    'panel-padding': rem(value.panel),
    'form-field-gap': rem(value.field),
    'section-gap': rem(value.section),
    'page-padding': rem(value.page),
    'table-cell-py': rem(value.tableCell),
  }
}
