import { useEffect, useState } from 'react'
import { Keyboard } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** Bottom controls own home-indicator clearance, not the full-height pane. */
export function useMobileBottomInset() {
  return useMobileKeyboardInset().bottom
}

export function useMobileKeyboardInset() {
  const { bottom } = useSafeAreaInsets()
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible())
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  return { bottom: keyboardVisible ? 0 : bottom, keyboardVisible }
}
