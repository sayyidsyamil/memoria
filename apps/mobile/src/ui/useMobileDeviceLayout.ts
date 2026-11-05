import { Dimensions, Platform, useWindowDimensions } from 'react-native'
import { mobileDeviceLayout } from './mobileDeviceLayout'

export function useMobileDeviceLayout() {
  const { width } = useWindowDimensions()
  const screen = Dimensions.get('screen')
  return mobileDeviceLayout({
    platform: Platform.OS,
    tablet: Platform.OS === 'ios' && Platform.isPad,
    width,
    screenWidth: screen.width,
    screenHeight: screen.height,
  })
}
