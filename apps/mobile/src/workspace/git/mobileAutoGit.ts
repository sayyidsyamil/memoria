type AutoGitState = { enabled: boolean; foreground: boolean; blocked: boolean }

type SyncOperation = { controller: AbortController; promise: Promise<void> }

export function createMobileAutoGit(run: (signal?: AbortSignal) => Promise<unknown>, idleMs = 30_000) {
  let state: AutoGitState = { enabled: false, foreground: true, blocked: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0
  let attempted = 0
  let running: SyncOperation | undefined
  let disposed = false
  let failures = 0
  let retryAt = 0

  function cancelTimer() {
    clearTimeout(timer)
    timer = undefined
  }

  function schedule() {
    cancelTimer()
    if (disposed || running || !canSync(state)) return
    if (version > attempted || retryAt) timer = setTimeout(() => { void execute() }, Math.max(idleMs, retryAt - Date.now()))
  }

  function completed(retry: boolean) {
    failures = retry ? failures + 1 : 0
    retryAt = retry ? Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4)) : 0
  }

  function succeeded(result: unknown) {
    if (editorSyncDeferred(result)) {
      attempted = -1
      return
    }
    completed(retryRequested(result))
  }

  function execute() {
    attempted = version
    const controller = new AbortController()
    const promise = Promise.resolve().then(() => run(controller.signal))
      .then(succeeded)
      .catch(error => { completed(syncFailureKind(error) === 'retry') })
      .then(() => { running = undefined; schedule() })
    running = { controller, promise }
    return running
  }

  async function flush(signal?: AbortSignal) {
    cancelTimer()
    if (disposed || signal?.aborted) return
    if (running) return followSync(running, signal)
    if (!state.enabled || state.blocked) return
    await followSync(execute(), signal)
  }

  return {
    dirty: () => { version += 1; schedule() },
    reconnect: () => { retryAt = 0; version += 1; schedule() },
    flush,
    update: (next: AutoGitState) => {
      if (sameState(state, next)) return
      state = next
      schedule()
    },
    dispose: () => { disposed = true; cancelTimer(); running?.controller.abort() },
  }
}

function editorSyncDeferred(result: unknown) {
  if (typeof result !== 'object' || result === null) return false
  return 'deferred' in result && result.deferred === true
}

async function followSync(operation: SyncOperation, signal?: AbortSignal) {
  const abort = () => operation.controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try { await operation.promise }
  finally { signal?.removeEventListener('abort', abort) }
}

function canSync(state: AutoGitState) {
  return state.enabled && state.foreground && !state.blocked
}

function sameState(previous: AutoGitState, next: AutoGitState) {
  return previous.enabled === next.enabled && previous.foreground === next.foreground && previous.blocked === next.blocked
}
import { retryRequested, syncFailureKind } from '../syncFailure'

