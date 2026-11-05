import { waitForStartupPhase } from '../lib/startupPerformance'

/** How long the web waits for the cached note list before it loads the editor anyway. */
const WEB_LIST_FIRST_LIMIT_MS = 1500
/** After the list painted, the editor bundle waits this long unless the user acts first. */
const WEB_EDITOR_GRACE_MS = 1000
/** Longest wait for an idle moment once the grace period is over. */
const WEB_IDLE_LIMIT_MS = 500
const USER_INTENT_EVENTS = ['pointerdown', 'keydown'] as const

function isWebBuild(): boolean {
  return import.meta.env.VITE_MEMORIA_WEB_BUILD === 'true'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function whenIdle(): Promise<void> {
  if (typeof requestIdleCallback !== 'function') return delay(0)
  return new Promise((resolve) => { requestIdleCallback(() => { resolve() }, { timeout: WEB_IDLE_LIMIT_MS }) })
}

/** Resolves after `ms`, or as soon as the user presses a pointer or a key. */
function graceOrUserIntent(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      for (const type of USER_INTENT_EVENTS) window.removeEventListener(type, finish, true)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    for (const type of USER_INTENT_EVENTS) window.addEventListener(type, finish, true)
  })
}

/**
 * With no note open, the editor bundle waits for the shell. On the web it also stays off the
 * cached note list's critical path: it waits for the list to paint, then for a short grace
 * period (cut short by the first pointer or key press) and an idle moment (TOL-206).
 */
export async function waitForEditorTurn(): Promise<void> {
  await waitForStartupPhase('react_shell')
  if (!isWebBuild()) return
  await Promise.race([waitForStartupPhase('note_list_painted'), delay(WEB_LIST_FIRST_LIMIT_MS)])
  await graceOrUserIntent(WEB_EDITOR_GRACE_MS)
  await whenIdle()
}
