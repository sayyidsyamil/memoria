export type NativeEditorLossReason = 'contentProcessTerminated' | 'renderProcessGone' | 'initialContentSyncFailed'

type Options = {
  active: boolean
  generation?: number
  isBlocked: () => boolean
  restart: (generation: number, reason: NativeEditorLossReason) => void
}

type RecoveryState = {
  active: boolean
  disposed: boolean
  generation: number
  initialContentRetryUsed: boolean
  options: Options
  pending: NativeEditorLossReason | null
  timer: ReturnType<typeof setTimeout> | undefined
}

/** A dead WebView must not serialize or restart across a working-copy replacement. */
export function createNativeEditorRecovery(options: Options) {
  const state: RecoveryState = {
    active: options.active,
    disposed: false,
    generation: options.generation ?? 0,
    initialContentRetryUsed: false,
    options,
    pending: null,
    timer: undefined,
  }
  return {
    lost: (session: number, reason: NativeEditorLossReason) => recordEditorLoss(state, session, reason),
    setActive: (value: boolean) => setRecoveryActive(state, value),
    dispose: () => disposeRecovery(state),
  }
}

function recordEditorLoss(state: RecoveryState, session: number, reason: NativeEditorLossReason) {
  if (state.disposed || session !== state.generation || state.pending) return
  if (shouldIgnoreInitialSyncRetry(state, reason)) return
  state.pending = reason
  resumeRecovery(state)
}

function shouldIgnoreInitialSyncRetry(state: RecoveryState, reason: NativeEditorLossReason) {
  if (reason !== 'initialContentSyncFailed') return false
  if (state.initialContentRetryUsed) return true
  state.initialContentRetryUsed = true
  return false
}

function setRecoveryActive(state: RecoveryState, active: boolean) {
  state.active = active
  resumeRecovery(state)
}

function resumeRecovery(state: RecoveryState) {
  cancelRecoveryTimer(state)
  if (state.disposed || !state.active || !state.pending) return
  if (state.options.isBlocked()) {
    state.timer = setTimeout(() => resumeRecovery(state), 100)
    return
  }
  const reason = state.pending
  state.pending = null
  state.options.restart(++state.generation, reason)
}

function disposeRecovery(state: RecoveryState) {
  state.disposed = true
  state.pending = null
  cancelRecoveryTimer(state)
}

function cancelRecoveryTimer(state: RecoveryState) {
  clearTimeout(state.timer)
  state.timer = undefined
}
