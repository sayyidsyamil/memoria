import { StyleSheet, Text } from 'react-native'
import { metricReadout, type MobileLayoutMetrics } from './mobileLayoutProbe'

export function MobileLayoutProbeReadout({
  metrics,
  testID,
}: {
  metrics: MobileLayoutMetrics
  testID: string
}) {
  const metricText = metricReadout(metrics)
  if (!metricText) return null

  return (
    <Text
      accessibilityLabel={metricText}
      nativeID={testID}
      style={styles.readout}
      testID={testID}
    >
      {metricText}
    </Text>
  )
}

const styles = StyleSheet.create({
  readout: {
    bottom: 0,
    color: 'transparent',
    fontSize: 1,
    height: 1,
    left: 0,
    opacity: 0.01,
    position: 'absolute',
    width: 1,
  },
})
