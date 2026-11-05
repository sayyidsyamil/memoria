import { StyleSheet } from 'react-native'
import type { MobileMetrics } from '../ui/mobileMetrics'
import type { MobileColors } from '../ui/theme/mobilePalette'

export function createTabletWorkspaceStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { panel: desktopPanelParity } = metrics
  const styles = StyleSheet.create({
    shell: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: mobileColors.app,
      overflow: 'hidden',
    },
    shellRoot: {
      flex: 1,
      flexDirection: 'column',
      backgroundColor: mobileColors.app,
    },
    panelHost: {
      alignSelf: 'stretch',
      height: '100%',
    },
    propertiesPanelHost: {
      width: desktopPanelParity.inspectorWidth,
    },
    leftChromeHost: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      height: '100%',
    },
    leftChromeViewport: {
      height: '100%',
      flexShrink: 0,
      overflow: 'hidden',
    },
  })
  return { mobileColors, styles }
}
