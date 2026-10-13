import { useEffect } from 'react'
import { silentTelemetryConsent } from '../lib/firstRun'
import type { Settings } from '../types'

/** Records "no telemetry" once, without a dialog, when this build has no telemetry keys. */
export function useSilentTelemetryConsent(
  settings: Settings,
  settingsLoaded: boolean,
  saveSettings: (settings: Settings) => Promise<void>,
): void {
  const silent = settingsLoaded ? silentTelemetryConsent(settings.telemetry_consent) : null
  useEffect(() => {
    if (silent === null) return
    void saveSettings({
      ...settings,
      telemetry_consent: false,
      crash_reporting_enabled: false,
      analytics_enabled: false,
      anonymous_id: null,
    })
    // Only the stored consent matters; saving again is skipped once it is false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silent])
}
