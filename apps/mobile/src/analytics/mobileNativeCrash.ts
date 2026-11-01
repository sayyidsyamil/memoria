import { requireOptionalNativeModule } from 'expo'
import type { MobileTelemetryContext } from './mobileTelemetryContext'

type NativeCrashModule = { start: (dsn: string, metadata: MobileTelemetryContext) => void; stop: () => void }

export function mobileNativeCrash(dsn: string, metadata: MobileTelemetryContext) {
  const native = requireOptionalNativeModule<NativeCrashModule>('MemoriaCrashReporting')
  return { start: () => native?.start(dsn, metadata), stop: () => native?.stop() }
}
