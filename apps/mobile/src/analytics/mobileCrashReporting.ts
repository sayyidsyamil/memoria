import type { ErrorEvent } from '@sentry/react-native'
import { sanitizeMobileCrash } from './mobileCrashPrivacy'

export type MobileCrashArea = 'workspace' | 'persistence' | 'git'
export type MobileCrashDriver = {
  start: (filter: (event: ErrorEvent) => ErrorEvent | null) => (() => Promise<void>) | Promise<() => Promise<void>>
  capture: (error: unknown, area: MobileCrashArea) => void
  abort: () => void
}

type State = { enabled: boolean; close: (() => Promise<void>) | null; pending: Promise<void> }
type Dependencies = { configured: boolean; driver: MobileCrashDriver }

export function createMobileCrashReporting(dependencies: Dependencies) {
  const state: State = { enabled: false, close: null, pending: Promise.resolve() }
  return {
    capture: (error: unknown, area: MobileCrashArea) => capture(state, dependencies.driver, error, area),
    setEnabled: (requested: boolean) => setEnabled(state, dependencies, requested),
  }
}

function setEnabled(state: State, { configured, driver }: Dependencies, requested: boolean) {
  state.enabled = configured && requested
  if (!state.enabled) driver.abort()
  state.pending = state.pending.then(() => transition(state, driver, requested)).catch(() => {
    driver.abort()
    state.close = null
  })
  return state.pending
}

async function transition(state: State, driver: MobileCrashDriver, requested: boolean) {
  if (!requested) return stopReporting(state)
  if (!state.enabled || state.close) return
  state.close = await driver.start(event => state.enabled ? sanitizeMobileCrash(event) : null)
}

async function stopReporting(state: State) {
  const stop = state.close
  state.close = null
  await stop?.()
}

function capture(state: State, driver: MobileCrashDriver, error: unknown, area: MobileCrashArea) {
  if (!state.enabled || !state.close) return
  try { driver.capture(error, area) } catch { /* Reporting must never interrupt local work. */ }
}
