import { useEffect } from 'react'
import { APP_STORAGE_KEYS } from '../constants/appStorage'

// Decided once per app session, and only while the app is starting: showing the sidebar later must not pop the window open.
const STARTUP_WINDOW_MS = 30_000
let startedAt = Date.now()
let settled = false

/** For tests: start a new app session. */
export function resetStartupMemoryHub(): void {
  startedAt = Date.now()
  settled = false
}

/** Whether the app was left with a note open. That note is reopened, and it stays in front: the user chose it. */
function noteWillReopen(): boolean {
  try {
    return !!localStorage.getItem(APP_STORAGE_KEYS.lastActiveNotePath)
  } catch {
    return false
  }
}

/**
 * At startup, opens the memory window on Decisions when the workspace holds meetings or tracked decisions, instead of
 * leaving an empty note editor. `holdsMemory` is undefined until known. A note that is being reopened wins.
 */
export function useStartupMemoryHub(holdsMemory: boolean | undefined, open: () => void): void {
  useEffect(() => {
    if (settled) return
    if (Date.now() - startedAt > STARTUP_WINDOW_MS || noteWillReopen()) { settled = true; return }
    if (holdsMemory === undefined) return
    settled = true
    if (holdsMemory) open()
  }, [holdsMemory, open])
}
