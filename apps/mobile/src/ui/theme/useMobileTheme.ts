import { createContext, useContext, useMemo } from 'react'
import { mobilePalettes, type MobileColorMode, type MobileColors } from './mobilePalette'
import { mobileMetrics, type MobileMetrics } from '../mobileMetrics'

export const MobileThemeContext = createContext<{ mode: MobileColorMode; colors: MobileColors; metrics: MobileMetrics }>({
  mode: 'light', colors: mobilePalettes.light, metrics: mobileMetrics[1.2],
})

export function useMobileTheme() {
  return useContext(MobileThemeContext)
}

export function useMobileColors() {
  return useMobileTheme().colors
}

export function useMobileMetrics() {
  return useMobileTheme().metrics
}

export function useMobileStyles<T>(createStyles: (colors: MobileColors, metrics: MobileMetrics) => T): T {
  const { colors, metrics } = useMobileTheme()
  return useMemo(() => createStyles(colors, metrics), [colors, metrics, createStyles])
}
