import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function usePhoneViewportWidth() {
  const { width } = useWindowDimensions()
  const { left, right } = useSafeAreaInsets()
  return Math.max(1, width - left - right)
}
