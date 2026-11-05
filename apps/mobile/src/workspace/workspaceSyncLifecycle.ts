import type { createMobileAutoGit } from './git/mobileAutoGit'
import { withWorkspaceBackgroundSync } from './workspaceBackgroundSync'

type Scheduler = ReturnType<typeof createMobileAutoGit>
type Readiness = () => { enabled: boolean; blocked: boolean }

export function createWorkspaceSyncLifecycle(
  scheduler: Scheduler, readiness: Readiness, initialState: string,
  background = withWorkspaceBackgroundSync,
) {
  let current = initialState
  let pending: Promise<unknown> | undefined
  const immediateFlushScheduled = { value: false }
  function refresh() {
    const ready = readiness()
    scheduler.update({ ...ready, foreground: current === 'active' })
    scheduleImmediateFlush(scheduler, readiness, () => current === 'active', immediateFlushScheduled)
  }
  function change(next: string) {
    const previous = current
    current = next
    if (next === 'active' && previous !== 'active') scheduler.dirty()
    refresh()
    if (!leavingForeground(previous, next) || !readiness().enabled || pending) return
    pending = background(signal => scheduler.flush(signal))
      .catch(() => { /* Preserve pending work for the next foreground attempt. */ })
      .finally(() => { pending = undefined })
  }
  refresh()
  return { change, refresh, poll: () => { if (current === 'active') scheduler.dirty() } }
}

function leavingForeground(previous: string, next: string) {
  return previous === 'active' && next !== 'active'
}

function scheduleImmediateFlush(scheduler: Scheduler, readiness: Readiness, isForeground: () => boolean,
  scheduled: { value: boolean }) {
  const ready = readiness()
  if (scheduled.value || !isForeground() || !ready.enabled || ready.blocked) return
  scheduled.value = true
  void Promise.resolve().then(() => {
    scheduled.value = false
    const latest = readiness()
    if (!isForeground() || !latest.enabled || latest.blocked) return
    void scheduler.flush()
  })
}
