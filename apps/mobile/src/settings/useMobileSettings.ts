import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createMobileSettingsController } from './mobileSettingsController'
import { readMobileSettings, writeMobileSettings } from './mobileSettingsStorage'

export function useSettingsController() {
  const [controller] = useState(() => createMobileSettingsController({ read: readMobileSettings, write: writeMobileSettings }))
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const [opened, setOpened] = useState(false)
  useEffect(() => { void controller.load() }, [controller])
  return { ...state, opened, open: () => setOpened(true), close: () => setOpened(false), update: controller.update, retry: controller.load }
}

export const SettingsContext = createContext<ReturnType<typeof useSettingsController> | null>(null)

export function useMobileSettings() {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('Missing MobileSettingsProvider')
  return context
}
