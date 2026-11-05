import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewProps } from 'react-native'
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated'
import { GestureDetector } from 'react-native-gesture-handler'
import type { usePhonePanelRail } from './usePhonePanelRail'
import { phoneWorkspaceSidebarDrawerWidth } from './phoneWorkspaceTransitions'
import { usePhoneViewportWidth } from './usePhoneViewportWidth'

type Props = { children: ReactNode; panelRail: ReturnType<typeof usePhonePanelRail>; swipeHandlers?: ViewProps }

export function PhoneWorkspaceTransition({ children, panelRail, swipeHandlers }: Props) {
  const width = usePhoneViewportWidth()
  const { offset } = panelRail
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }))
  const stage = <View {...swipeHandlers} className={panelRail.enabled ? undefined : '!overflow-clip'} style={styles.stage} testID="phone-transition-stage">
    <Reanimated.View style={[styles.rail, { width: phoneWorkspaceSidebarDrawerWidth(width) + 3 * width }, animatedStyle]}>
      {children}
    </Reanimated.View>
  </View>
  return panelRail.enabled ? <GestureDetector gesture={panelRail.gesture}>{stage}</GestureDetector> : stage
}

const styles = StyleSheet.create({
  rail: { flex: 1 },
  stage: { flex: 1, overflow: 'hidden' },
})
