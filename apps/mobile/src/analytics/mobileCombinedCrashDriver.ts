import type { MobileCrashDriver } from './mobileCrashReporting'

export function combineMobileCrashDrivers(
  javascript: MobileCrashDriver,
  native: { start: () => void; stop: () => void },
): MobileCrashDriver {
  let generation = 0
  const abort = () => { generation += 1; javascript.abort(); native.stop() }
  return {
    abort,
    capture: javascript.capture,
    start: async filter => {
      const lease = generation
      const close = await javascript.start(filter)
      if (lease !== generation) { await close(); return async () => {} }
      try { native.start() } catch (error) { abort(); await close(); throw error }
      return async () => { native.stop(); await close() }
    },
  }
}
