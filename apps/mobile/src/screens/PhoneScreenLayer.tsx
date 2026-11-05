import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

type PhoneScreenLayerProps = {
  active: boolean
  retain?: boolean
  frame: { left: number; width: number }
  testID?: string
  eager?: boolean
  children: ReactNode
}

const visibilityProps = {
  active: { accessibilityElementsHidden: false, importantForAccessibility: 'auto', pointerEvents: 'auto' },
  hidden: { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', pointerEvents: 'none' },
} as const

export function PhoneScreenLayer({ active, retain = false, children, frame, testID, eager = false }: PhoneScreenLayerProps) {
  const [visited, setVisited] = useState(active)
  if (active && !visited) setVisited(true)
  if (!eager && !active && !(retain && visited)) return null
  const visibility = active ? visibilityProps.active : visibilityProps.hidden
  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, frame]}
      testID={testID}
    >
      <View {...visibility} style={styles.content}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, bottom: 0 },
  content: { flex: 1 },
})
