import { StyleSheet } from 'react-native'
import type { MobileMetrics } from '../../ui/mobileMetrics'
import type { MobileColors } from '../../ui/theme/mobilePalette'

export function createVaultManagerStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const mobileSpace = metrics.space
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: mobileColors.overlay, justifyContent: 'center', alignItems: 'center', padding: mobileSpace.lg },
  panel: { width: '100%', maxWidth: 560, maxHeight: '90%', borderRadius: 8, overflow: 'hidden' },
  content: { padding: mobileSpace.lg, gap: mobileSpace.lg },
  settingsContent: { gap: metrics.size(24) },
  section: { gap: mobileSpace.sm },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: mobileSpace.sm },
  label: { fontSize: metrics.size(16), fontWeight: '600', color: mobileColors.text },
  detail: { fontSize: metrics.size(12), lineHeight: metrics.size(18), color: mobileColors.textMuted },
  error: { fontSize: metrics.size(12), lineHeight: metrics.size(18), color: mobileColors.danger },
  code: { fontSize: metrics.size(24), fontWeight: '600', color: mobileColors.text, textAlign: 'center', paddingVertical: mobileSpace.sm },
  vault: { alignItems: 'center', justifyContent: 'flex-start', minHeight: 44 },
  progress: { gap: mobileSpace.sm, flexDirection: 'row', alignItems: 'center' },
  })
}
