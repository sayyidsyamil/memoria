import type { AppStateStatus } from 'react-native'
import type { createMobileUpdateChannelController } from './mobileUpdateChannel'

type AppLifecycle = {
  currentState: AppStateStatus | null
  addEventListener: (event: 'change', listener: (state: AppStateStatus) => void) => { remove: () => void }
}
type UpdateController = Pick<ReturnType<typeof createMobileUpdateChannelController>, 'snapshot' | 'check'>

/** Native launch already checks; only later foreground transitions need another probe. */
export function watchMobileForegroundUpdates(source: AppLifecycle, controller: UpdateController, now = Date.now) {
  let previous = source.currentState
  let lastCheck = now()
  const subscription = source.addEventListener('change', next => {
    const resumed = previous !== 'active' && next === 'active'
    previous = next
    const { busy, phase } = controller.snapshot()
    if (!resumed || busy || phase === 'ready' || now() - lastCheck < 60_000) return
    lastCheck = now()
    void controller.check()
  })
  return () => subscription.remove()
}
