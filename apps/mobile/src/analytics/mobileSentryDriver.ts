import type * as SentrySdk from '@sentry/react-native'
import type { MobileCrashDriver } from './mobileCrashReporting'
import type { MobileTelemetryContext } from './mobileTelemetryContext'
import { createMobileSentryTransport } from './mobileSentryTransport'

type Sdk = Pick<typeof SentrySdk, 'init' | 'captureException' | 'close'>
type Context = { metadata: MobileTelemetryContext; dsn: string }

export function createMobileSentryDriver(context: Context, load: () => Promise<Sdk>): MobileCrashDriver {
  const transport = createMobileSentryTransport()
  let sdk: Sdk | null = null
  let generation = 0
  return {
    abort: () => { generation += 1; transport.abort() },
    capture: (error, area) => { sdk?.captureException(error, { tags: { area } }) },
    start: async (filter) => {
      const lease = generation
      const loaded = await load()
      if (lease !== generation) return async () => {}
      transport.activate()
      loaded.init(sentryOptions(context, filter, transport.transport))
      sdk = loaded
      return async () => { sdk = null; await loaded.close() }
    },
  }
}

function sentryOptions(
  { metadata, dsn }: Context,
  filter: Parameters<MobileCrashDriver['start']>[0],
  transport: ReturnType<typeof createMobileSentryTransport>['transport'],
): Parameters<Sdk['init']>[0] {
  const release = `memoria-mobile@${metadata.app_version}+${metadata.build_number}`
  return {
    dsn, release, dist: metadata.build_number, environment: metadata.distribution,
    // Native reports bypass JS redaction; they need a native filter before opt-in.
    enableNative: false,
    sendDefaultPii: false, sendClientReports: false, maxBreadcrumbs: 0,
    enableAutoSessionTracking: false, enableAutoPerformanceTracing: false,
    enableAppStartTracking: false, enableNativeFramesTracking: false, enableStallTracking: false,
    enableLogs: false, attachScreenshot: false, attachViewHierarchy: false,
    enableCaptureFailedRequests: false, patchGlobalPromise: false, transport,
    integrations: integrations => integrations.filter(integration =>
      ['ReactNativeErrorHandlers', 'Dedupe', 'FunctionToString', 'InboundFilters', 'LinkedErrors'].includes(integration.name)),
    beforeSend: (event, hint) => {
      hint.attachments = []
      const clean = filter(event)
      return clean ? { ...clean, release, dist: metadata.build_number, environment: metadata.distribution, tags: metadata } : null
    },
    beforeBreadcrumb: () => null,
  }
}
