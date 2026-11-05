import type { MobileCrashArea } from './mobileCrashReporting'

type Reporter = (error: unknown, area: MobileCrashArea) => void
let reporter: Reporter = () => {}

export function registerMobileCrashReporter(next: Reporter) { reporter = next }
export function captureMobileError(error: unknown, area: MobileCrashArea) { reporter(error, area) }
