import { expect, it, vi } from 'vitest'
import { createPropertyPanelStyles } from './MobilePropertiesPanel.styles'
import { mobileMetrics } from '../../ui/mobileMetrics'
import { mobilePalettes } from '../../ui/theme/mobilePalette'

vi.mock('react-native', () => ({ StyleSheet: { create: (styles: object) => styles, hairlineWidth: 0.5 } }))

it.each(['light', 'dark'] as const)('keeps relationship chips close without overlapping touch targets in %s mode', mode => {
  const { relationshipStyles: styles, propertyStyles } = createPropertyPanelStyles(mobilePalettes[mode], mobileMetrics[1.2])
  expect(styles.values.gap).toBe(0)
  expect(styles.row.minHeight).toBeGreaterThanOrEqual(44)
  expect(styles.openTarget.minHeight).toBeGreaterThanOrEqual(44)
  expect(styles.remove.minHeight).toBeGreaterThanOrEqual(44)
  expect(styles.background.top + styles.background.bottom + styles.values.gap).toBe(4)
  expect(propertyStyles.relationshipGroup.marginTop).toBeGreaterThan(0)
  expect(propertyStyles.relationshipGroup.paddingTop).toBeGreaterThan(0)
  expect(propertyStyles.relationshipGroup.borderTopWidth).toBeGreaterThan(0)
})
