import { useMobileColors } from '../../ui/theme/useMobileTheme'
import type { ComponentProps } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import * as SwitchPrimitive from '@rn-primitives/switch'

// RNR Root/Thumb composition with explicit native layout, matching desktop roles.
type SwitchProps = Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'style'> & { style?: StyleProp<ViewStyle> }

export function Switch({ checked, disabled, style, ...props }: SwitchProps) {
  const mobileColors = useMobileColors()
  return <SwitchPrimitive.Root
    {...props} checked={checked} disabled={disabled} hitSlop={8}
    style={StyleSheet.flatten([{ width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center',
      backgroundColor: checked ? mobileColors.primary : mobileColors.borderStrong, opacity: disabled ? 0.5 : 1 }, style])}
  >
    <SwitchPrimitive.Thumb style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: mobileColors.textInverse, transform: [{ translateX: checked ? 18 : 0 }] }} />
  </SwitchPrimitive.Root>
}
