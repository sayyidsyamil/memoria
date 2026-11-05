import { mobilePalettes } from './theme/mobilePalette'

// Canonical colors for saved document marks; UI components use the active theme.
export const mobileColors = mobilePalettes.light

export const mobileSpace = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const mobileRadius = {
  sm: 4,
  md: 6,
  lg: 8,
  pill: 999,
} as const

export const mobileType = {
  micro: 10,
  caption: 12,
  body: 14,
  bodyLarge: 16,
  title: 18,
  hero: 34,
} as const
