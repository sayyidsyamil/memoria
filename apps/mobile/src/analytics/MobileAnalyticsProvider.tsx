import { useEffect, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { useMobileSettings } from '../settings/useMobileSettings'
import { createMobileAnalytics } from './mobileAnalytics'
import { mobileAnalyticsEndpoint, posthogSender } from './posthogTransport'
import { AnalyticsContext } from './useMobileAnalytics'
import { mobileRuntimeContext, mobileTelemetryConfig } from './mobileTelemetryRuntime'
import { mobileCrashReporting } from './mobileSentry'

function nativeAnalytics() {
  const { posthogKey: key, posthogHost } = mobileTelemetryConfig()
  const endpoint = mobileAnalyticsEndpoint(key, posthogHost)
  return createMobileAnalytics({
    configured: endpoint !== null,
    createId: randomUUID,
    platform: Platform.OS,
    context: mobileRuntimeContext(),
    send: endpoint ? posthogSender(endpoint, key) : async () => {},
  })
}

export function MobileAnalyticsProvider({ children }: { children: ReactNode }) {
  const [analytics] = useState(nativeAnalytics)
  const { ready, settings } = useMobileSettings()
  useEffect(() => {
    analytics.setEnabled(ready && settings.analytics)
    return () => analytics.setEnabled(false)
  }, [analytics, ready, settings.analytics])
  useEffect(() => {
    if (!ready) return
    void mobileCrashReporting.setEnabled(settings.crashReporting)
    return () => { void mobileCrashReporting.setEnabled(false) }
  }, [ready, settings.crashReporting])
  return <AnalyticsContext.Provider value={analytics}>{children}</AnalyticsContext.Provider>
}
