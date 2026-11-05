import { createContext, useContext } from 'react'
import { createMobileAnalytics } from './mobileAnalytics'

const disabledAnalytics = createMobileAnalytics({
  configured: false, createId: () => '', platform: 'unknown', send: async () => {},
})
export const AnalyticsContext = createContext(disabledAnalytics)

export function useMobileAnalytics() {
  return useContext(AnalyticsContext)
}
