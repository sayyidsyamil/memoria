import type { ReactNode } from 'react'
import { SettingsContext, useSettingsController } from './useMobileSettings'

export function MobileSettingsProvider({ children }: { children: ReactNode }) {
  return <SettingsContext.Provider value={useSettingsController()}>{children}</SettingsContext.Provider>
}
