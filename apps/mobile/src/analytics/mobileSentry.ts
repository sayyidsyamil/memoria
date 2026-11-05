import { createMobileCrashReporting } from './mobileCrashReporting'
import { mobileRuntimeContext, mobileTelemetryConfig } from './mobileTelemetryRuntime'
import { createMobileSentryDriver } from './mobileSentryDriver'
import { registerMobileCrashReporter } from './mobileCrashChannel'
import { combineMobileCrashDrivers } from './mobileCombinedCrashDriver'
import { mobileNativeCrash } from './mobileNativeCrash'

const dsn = mobileTelemetryConfig().sentryDsn
const metadata = mobileRuntimeContext()
const javascript = createMobileSentryDriver({ metadata, dsn }, () => import('@sentry/react-native'))
const driver = combineMobileCrashDrivers(javascript, mobileNativeCrash(dsn, metadata))
export const mobileCrashReporting = createMobileCrashReporting({ configured: validDsn(dsn), driver })
registerMobileCrashReporter(mobileCrashReporting.capture)

function validDsn(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.username) && !url.password && /^\/\d+$/.test(url.pathname)
      && !url.search && !url.hash
  } catch { return false }
}
