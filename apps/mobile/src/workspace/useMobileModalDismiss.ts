import { useEffect, useLayoutEffect, useRef } from 'react'
import { BackHandler, Platform } from 'react-native'
import { optionalNativeMobileKeyCommandsModule } from '../native/mobileNativeKeyCommands'
import { createMobileModalDismissal } from './mobileModalDismissal'
import { installMobileWorkspaceKeyboardShortcuts } from './mobileWorkspaceKeyboardShortcuts'

let unsubscribe: (() => void) | undefined
const modals = createMobileModalDismissal(active => {
  unsubscribe?.()
  unsubscribe = active ? installDismissalInputs() : undefined
  void optionalNativeMobileKeyCommandsModule()?.setModalOpen?.(active)
})

function installDismissalInputs() {
  const keyboard = installMobileWorkspaceKeyboardShortcuts(event => modals.dismiss(event))
  const back = Platform.OS === 'android'
    ? BackHandler.addEventListener('hardwareBackPress', () => modals.dismiss({ key: 'Escape' }))
    : undefined
  return () => { back?.remove(); keyboard?.() }
}

export function useMobileModalDismiss(onClose: () => void, active = true) {
  const current = useRef(onClose)
  useLayoutEffect(() => { current.current = onClose }, [onClose])
  useEffect(() => {
    if (active) return modals.register(() => current.current())
  }, [active])
}
